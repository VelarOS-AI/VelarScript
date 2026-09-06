function __velarTrack(subscribers) {
  __velarRuntime.trackSubscribers(subscribers);
}

function __velarToRaw(value) { return __velarRuntime.toRaw(value); }
function __velarReactive(value, parent = null) { return __velarRuntime.reactive(value, parent); }

function __velarWebListPop(value, requested = -1) {
  return __velarReactive(__velarListPop(value, requested));
}

function __velarUntracked(read) {
  const previous = __velarRuntime.activeObserver;
  __velarRuntime.activeObserver = null;
  try { return read(); } finally { __velarRuntime.activeObserver = previous; }
}

function __velarCleanupObserver(observer) {
  __velarRuntime.cleanupObserver(observer);
}

// P2b-9: a self-invalidating render used to report only that it happened. The
// stack top was the graph's own trigger, so it named neither the collection
// being written nor the scope reading it, and the distance between symptom and
// cause was the whole debugging cost. Everything below is already known where
// the budget trips: the observer carries its component and its watch subject,
// and the graph has just recorded which path re-triggered it. Naming the write
// is the difference between bisecting a render and reading one line.
//
// The advice is attached to the shape that earns it. A "collection" subject
// means a collection was read for its size or contents and then written in the
// same pass, and the two spellings that end it are the same two every time:
// take the position from the loop instead of from the collection, or read the
// value out before writing. The kind arrives beside the phrase, so nothing here
// reads a sentence back apart to decide.
function __velarSelfInvalidationMessage(mode, component, label, subject, kind) {
  let message = "A reactive " + mode + " cannot invalidate itself more than 100 times";
  if (component) message += " (" + component + ")";
  else if (label) message += " (watching " + label + ")";
  if (!subject) return message;
  message += ": it writes " + subject + " while reading it";
  if (kind === "collection") {
    return message + ". A position taken from the collection being written -- 'items.get(built.size)' inside the loop that appends to 'built' -- reads it on every pass; take the position from a two-slot 'for value, index in ...' instead, or read what you need into a binding before the loop.";
  }
  return message + ". Read it into a binding before the code that writes it, so the write cannot reach the read that tracked it.";
}

// D90 R21: "label" names the observer in a report -- a watch carries its
// subject as the author spelled it -- and "sequence" is its registration
// number, which is the order the flush runs the watch tier in. The counter is
// application-wide rather than per module, so two modules' watches order by the
// order the two modules initialized.
function __velarObserver(read, mode, scope, label = "") {
  // The first run of a DOM observer executes while its JSX position is being
  // constructed, and construction is transactional: the failure must reach
  // the surrounding owner (the mount transaction at the root, the containing
  // child position otherwise) so the promised fatal state or contained
  // placeholder appears instead of a silently empty region. Later runs are
  // updates; their failures are reported and the last valid DOM survives.
  let initial = mode === "dom";
  const observer = {
    mode,
    label,
    sequence: __velarNextObserverSequence(),
    component: scope !== null && scope !== undefined && typeof scope.component === "string" ? scope.component : "",
    stopped: false,
    running: false,
    selfInvalidations: 0,
    // P2b-9: the reactive path whose write landed while this observer was
    // reading. The graph fills it in only on a self-invalidating write, so the
    // runaway report can name what to go and look at.
    selfInvalidationSubject: "",
    selfInvalidationKind: "",
    dependencies: __velarGraphCreateSet(),
    run() {
      if (observer.stopped) return;
      observer.running = true;
      try { __velarRuntime.runTracked(observer, read); }
      catch (error) {
        if (initial) throw error;
        __velarReport(error, mode === "watch" ? "watch" : "render", scope);
      }
      finally {
        observer.running = false;
        initial = false;
      }
    },
    notify() {
      if (observer.stopped) return;
      if (observer.running) {
        observer.selfInvalidations += 1;
        if (observer.selfInvalidations > 100) {
          observer.stop();
          __velarReport(new RangeError(__velarSelfInvalidationMessage(
            mode === "watch" ? "watch" : "render",
            observer.component,
            observer.label,
            observer.selfInvalidationSubject,
            observer.selfInvalidationKind,
          )), mode === "watch" ? "watch" : "render", scope);
          return;
        }
      } else {
        observer.selfInvalidations = 0;
      }
      // The registry owns the one scheduler: the emitted prelude used to carry
      // its own copy of the queue insert and the flush drain, and the two
      // definitions of one concept is what let a watch be classified three
      // different ways. The capability observers in packages/web/src/runtime.ts
      // have always scheduled this way.
      __velarRuntime.schedule(observer);
    },
    stop() { observer.stopped = true; __velarCleanupObserver(observer); },
  };
  __velarAppendOwned(scope.cleanups, () => observer.stop());
  observer.run();
  return observer;
}

// D70 rule 180: a reactive source read during component setup and stored in a
// plain binding is frozen. That is what const means, and a snapshot is a
// legitimate thing to want -- so the report fires when the source *diverges*
// from the snapshot, never when the snapshot is taken. A warning that fires on
// correct code is a warning people learn to ignore; one that fires only after
// the value on screen has actually gone stale cannot be wrong about that.
//
// The whole mechanism is installed only when the development host published its
// hooks, so a production build pays nothing for it: no map, no stack capture,
// and one already-false constant on the read path.
// One module's copy of this runtime cannot own the state: a component in one
// module reads a cell created in another, so the setup stack and the recorded
// reads live on the shared hooks object every copy sees.
const __velarFrozenHooks = (() => {
  const hooks = globalThis.__velarDevelopmentHooks;
  if (!hooks || typeof hooks.frozenRead !== "function") return null;
  if (hooks.setupScopes === undefined) {
    hooks.setupScopes = [];
    hooks.reads = __velarGraphCreateWeakMap();
    hooks.derived = [];
    hooks.internalDepth = 0;
  }
  return hooks;
})();
const __velarFrozenReadLimit = 32;

function __velarSetupBegin(scope) {
  if (__velarFrozenHooks) __velarAppendOwned(__velarFrozenHooks.setupScopes, scope);
  return scope;
}

function __velarSetupEnd(value) {
  if (__velarFrozenHooks && __velarFrozenHooks.setupScopes.length > 0) __velarFrozenHooks.setupScopes.length -= 1;
  return value;
}

// The framework's own reads on the author's behalf -- checking a prop is
// present, building the content a children slot holds, reading a handler
// thunk. None of them freezes anything the author wrote: the
// prop handle behind them stays live. Reporting them would be the false-positive
// flood D70 rule 180 rejected, in its most literal form.
function __velarInternalRead(read) {
  if (!__velarFrozenHooks) return __velarUntracked(read);
  __velarFrozenHooks.internalDepth += 1;
  try { return __velarUntracked(read); } finally { __velarFrozenHooks.internalDepth -= 1; }
}

function __velarRecordFrozenRead(cell, value) {
  if (!__velarFrozenHooks) return;
  if (__velarFrozenHooks.setupScopes.length === 0 || __velarFrozenHooks.internalDepth > 0) return;
  if (__velarRuntime.activeObserver !== null) return;
  // Only a value the reader can show is worth naming in the report; an object
  // read out of setup is followed through the deep graph, not frozen by this
  // read, so recording it would produce a report about the wrong thing.
  if (value !== null && typeof value === "object") return;
  const scope = __velarFrozenHooks.setupScopes[__velarFrozenHooks.setupScopes.length - 1];
  const existing = __velarGraphWeakMapRead(__velarFrozenHooks.reads, cell);
  if (existing) {
    if (existing.length >= __velarFrozenReadLimit) return;
    __velarAppendOwned(existing, { value, scope, site: new Error("velar frozen read") });
    return;
  }
  __velarGraphWeakMapWrite(__velarFrozenHooks.reads, cell, [{ value, scope, site: new Error("velar frozen read") }]);
}

// A derived value frozen during setup has no cell to hang a report on, and a
// read that left no subscriber is a read the cache never tells anything about.
// So the entries are kept in one dev-mode list and re-read after a state write
// -- the only thing that can move a derived value -- which is the same
// "report on divergence" rule the cells follow, reached the only way it can be.
function __velarRecordFrozenDerived(access, value) {
  if (!__velarFrozenHooks) return;
  if (__velarFrozenHooks.setupScopes.length === 0 || __velarFrozenHooks.internalDepth > 0) return;
  if (__velarRuntime.activeObserver !== null) return;
  if (value !== null && typeof value === "object") return;
  if (__velarFrozenHooks.derived.length >= __velarFrozenReadLimit * 4) return;
  const scope = __velarFrozenHooks.setupScopes[__velarFrozenHooks.setupScopes.length - 1];
  __velarAppendOwned(__velarFrozenHooks.derived, { access, value, scope, site: new Error("velar frozen read") });
}

function __velarReportFrozenDerived() {
  if (!__velarFrozenHooks || __velarFrozenHooks.derived.length === 0) return;
  const entries = __velarFrozenHooks.derived;
  const remaining = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    let current = entry.value;
    let failed = false;
    try { current = __velarUntracked(entry.access); }
    catch { failed = true; }
    if (failed || __velarGraphSame(entry.value, current)) { remaining[remaining.length] = entry; continue; }
    __velarPublishFrozenRead(entry, current);
  }
  __velarFrozenHooks.derived = remaining;
}

function __velarReportFrozenReads(cell, next) {
  if (!__velarFrozenHooks) return;
  __velarReportFrozenDerived();
  const entries = __velarGraphWeakMapRead(__velarFrozenHooks.reads, cell);
  if (!entries) return;
  __velarGraphWeakMapRemove(__velarFrozenHooks.reads, cell);
  for (let index = 0; index < entries.length; index += 1) {
    if (__velarGraphSame(entries[index].value, next)) continue;
    __velarPublishFrozenRead(entries[index], next);
  }
}

function __velarPublishFrozenRead(entry, next) {
  const component = entry.scope && entry.scope.component ? entry.scope.component : "a component";
  __velarFrozenHooks.frozenRead({
    message: "A reactive value read while " + component + " was being built was frozen at "
      + __velarFrozenText(entry.value) + ", and the source has now changed to " + __velarFrozenText(next)
      + ". Whatever was built from that read still shows the old value. If it is meant to follow, declare it with 'computed name = <expression>'; if the snapshot was intended, nothing here needs changing.",
    stack: __velarDomString(entry.site && entry.site.stack ? entry.site.stack : ""),
  });
}

function __velarFrozenText(value) {
  return typeof value === "string" ? __velarQuotedText(value) : __velarDomString(value);
}

// "name" is the declared name an author "state" wrote, carried on the cell and
// visible in the emitted source. The cells __velarResource and __velarAction
// build for their own pending/error fields are created without one, because
// they are the runtime's bookkeeping rather than state anyone declared.
//
// D90 R21: nothing read it any more. It existed for the two watch referees --
// only a cell with a declared name could be a declared write target -- and they
// went with the clause. It was left in place rather than removed with them,
// because it is a fact about the cell rather than a mechanism, and it is what a
// report naming the state a runaway wrote would have to read. D114 0.28.0 H-U1
// is that report: __velarSelfInvalidationWrite below reads it.
function __velarState(initial, name) {
  let value = __velarToRaw(initial);
  const subscribers = __velarGraphCreateSet();
  const cell = {
    velarStateName: name,
    // Named rather than shorthand so a captured stack shows a compiler frame
    // here: D70's report walks past its own frames to find the reading line,
    // and every JavaScript engine spells an anonymous getter differently.
    get: function __velarCellRead() {
      __velarTrack(subscribers);
      const current = __velarReactive(value, cell);
      __velarRecordFrozenRead(cell, current);
      return current;
    },
    set(next) {
      next = __velarToRaw(next);
      if (__velarGraphSame(value, next)) return next;
      const previous = value;
      value = next;
      __velarReportFrozenReads(cell, next);
      // Keep deep-change bubbling attached only to the value currently owned
      // by this cell. Otherwise every replaced object remains linked to the
      // state cell and continues to occupy the parent graph indefinitely.
      __velarRuntime.collectionUnlink(cell, previous);
      __velarReactive(value, cell);
      for (const observer of __velarGraphSetItems(subscribers)) {
        __velarSelfInvalidationWrite(observer, name);
        observer.notify();
      }
      return next;
    },
  };
  __velarReactive(value, cell);
  return cell;
}

// D114 0.28.0 H-U1: a state cell notifies its own subscriber set rather than
// going through the graph's keyed notify, so the write path the runaway report
// names was recorded for every deep write and for no write of a declared
// state -- and a scalar self-write only ever reaches the 100-round cap through
// a helper, which is why the gap read as "a write through a plain def". The
// condition is the graph's own, verbatim: a write that lands while its own
// reader is still running is the self-invalidating shape, and it is the only
// one worth describing. A cell with no declared name is runtime bookkeeping --
// __velarResource and __velarAction build theirs that way -- so it falls back
// to the same phrase describeSubject uses for a place it cannot name.
function __velarSelfInvalidationWrite(observer, name) {
  if (!observer.running) return;
  observer.selfInvalidationSubject = name ? "state '" + name + "'" : "a tracked value";
  observer.selfInvalidationKind = "value";
}

// D71 rule 182: a declared derived value reads bare, so it presents the same
// .get() face a state cell does. The cache underneath is the runtime's own
// memo; only the face it is read through differs.
function __velarComputed(read) {
  const access = __velarRuntime.computed(read);
  if (!__velarFrozenHooks) return __velarGraphFreeze({ get: access });
  return __velarGraphFreeze({
    get: function __velarDerivedRead() {
      const value = access();
      __velarRecordFrozenDerived(access, value);
      return value;
    },
  });
}

