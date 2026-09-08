function __velarCreateRuntime() {
  const runtime = Object.create(null);
  const domQueue = Object.freeze(__velarGraphCreateSet());
  const watchQueue = Object.freeze(__velarGraphCreateSet());
  const errorHandlers = Object.freeze(__velarGraphCreateSet());
  const unhandledFailures = Object.freeze(__velarGraphCreateSet());
  const actionFailures = Object.freeze(__velarGraphCreateWeakSet());
  const lookSources = Object.freeze(__velarGraphCreateWeakMap());
  const classSources = Object.freeze(__velarGraphCreateWeakMap());
  const dependencies = Object.freeze(__velarGraphCreateWeakMap());
  const rawToProxy = Object.freeze(__velarGraphCreateWeakMap());
  const proxyToRaw = Object.freeze(__velarGraphCreateWeakMap());
  const versions = Object.freeze(__velarGraphCreateWeakMap());
  const parents = Object.freeze(__velarGraphCreateWeakMap());
  const subscriptionStops = __velarGraphCreateWeakMap();
  const collectionBrands = __velarGraphCreateWeakMap();
  const iterateKey = Symbol.for("velar.reactive.iterate.v1");
  const structureKey = Symbol.for("velar.reactive.structure.v1");
  const deepKey = Symbol.for("velar.reactive.deep.v1");
  let lookImplementation = null;
  const toRaw = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
    return __velarGraphWeakMapRead(proxyToRaw, value) ?? value;
  };
  const trackSubscribers = (subscribers) => {
    const observer = runtime.activeObserver;
    if (!observer || observer.stopped) return;
    __velarGraphSetInsert(subscribers, observer);
    __velarGraphSetInsert(observer.dependencies, subscribers);
  };
  const runTracked = (observer, read) => {
    const previousDependencies = observer.dependencies;
    // Every run needs a second dependency set to diff against, and an observer
    // that re-runs thousands of times per second would otherwise allocate one
    // per run. The emptied previous set is kept as the next run's buffer.
    const spare = observer.spareDependencies;
    observer.spareDependencies = null;
    observer.dependencies = spare ?? __velarGraphCreateSet();
    const previousObserver = runtime.activeObserver;
    runtime.activeObserver = observer;
    try { return read(); }
    finally {
      runtime.activeObserver = previousObserver;
      for (const subscribers of __velarGraphSetItems(previousDependencies)) {
        if (__velarGraphSetContains(observer.dependencies, subscribers)) continue;
        // A stop fires exactly when an actual removal empties the set. Firing
        // on an already-empty set would let two detaching computeds whose
        // cleanups have not yet emptied their dependency sets re-trigger each
        // other without bound.
        if (__velarGraphSetRemove(subscribers, observer) && __velarGraphSetCount(subscribers) === 0) {
          const stop = __velarGraphWeakMapRead(subscriptionStops, subscribers);
          if (stop) stop();
        }
      }
      __velarGraphSetEmpty(previousDependencies);
      observer.spareDependencies = previousDependencies;
    }
  };
  const cleanupObserver = (observer) => {
    for (const subscribers of __velarGraphSetItems(observer.dependencies)) {
      if (__velarGraphSetRemove(subscribers, observer) && __velarGraphSetCount(subscribers) === 0) {
        const stop = __velarGraphWeakMapRead(subscriptionStops, subscribers);
        if (stop) stop();
      }
    }
    __velarGraphSetEmpty(observer.dependencies);
  };
  const track = (target, key) => {
    const observer = runtime.activeObserver;
    if (!observer || observer.stopped) return;
    target = toRaw(target);
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return;
    let byKey = __velarGraphWeakMapRead(dependencies, target);
    if (!byKey) { byKey = __velarGraphCreateMap(); __velarGraphWeakMapWrite(dependencies, target, byKey); }
    let subscribers = __velarGraphMapRead(byKey, key);
    if (!subscribers) {
      subscribers = __velarGraphCreateSet();
      __velarGraphMapWrite(byKey, key, subscribers);
      const ownedSubscribers = subscribers;
      __velarGraphWeakMapWrite(subscriptionStops, subscribers, () => {
        if (__velarGraphMapRead(byKey, key) !== ownedSubscribers) return;
        __velarGraphMapRemove(byKey, key);
        if (__velarGraphMapCount(byKey) === 0) __velarGraphWeakMapRemove(dependencies, target);
      });
    }
    trackSubscribers(subscribers);
  };
  // P2b-9: the path a write travelled, in the words the author would recognise.
  // Only the shape is named -- never a value -- because this reaches a report.
  // The kind travels beside the phrase rather than being read back out of it:
  // the reader of this is the runaway report, and it decides which remedy to
  // give from the kind, not by looking inside a sentence.
  const describeSubject = (target, key) => {
    const container = __velarGraphIsList(target) ? "List" : __velarGraphIsRecord(target) ? "record" : "collection";
    if (key === iterateKey || key === structureKey) return { kind: "collection", text: "the size or contents of a " + container };
    if (key === deepKey) return { kind: "value", text: "a nested value of a " + container };
    if (typeof key === "number") return { kind: "value", text: "element " + key + " of a " + container };
    if (typeof key === "string") return { kind: "value", text: "field '" + key + "'" };
    return { kind: "value", text: "a tracked value" };
  };
  const notify = (target, key) => {
    const byKey = __velarGraphWeakMapRead(dependencies, target);
    const subscribers = byKey ? __velarGraphMapRead(byKey, key) : null;
    if (subscribers) for (const observer of __velarGraphSetItems(subscribers)) {
      // A write that lands while its own reader is still running is the
      // self-invalidating shape, and it is the only one whose path is worth
      // describing -- so the description is built there and nowhere else, which
      // keeps every ordinary write to one property read on this path. The
      // observer's own budget owns the report; this only tells it what to name.
      if (observer.running) {
        const subject = describeSubject(target, key);
        observer.selfInvalidationSubject = subject.text;
        observer.selfInvalidationKind = subject.kind;
      }
      observer.notify();
    }
  };
  const bump = (target) => {
    __velarGraphWeakMapWrite(versions, target, (__velarGraphWeakMapRead(versions, target) ?? 0) + 1);
  };
  const trigger = (target, key, iterate = false, structure = false, indexFrom = null, allKeys = false) => {
    target = toRaw(target);
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return;
    bump(target);
    notify(target, key);
    if (allKeys || indexFrom !== null) {
      const byKey = __velarGraphWeakMapRead(dependencies, target);
      if (byKey) for (const candidate of __velarGraphMapKeyItems(byKey)) {
        if (candidate === key) continue;
        if (allKeys || (typeof candidate === "number" && candidate >= indexFrom)) notify(target, candidate);
      }
    }
    if (iterate) notify(target, iterateKey);
    if (structure) notify(target, structureKey);
    notify(target, deepKey);
    const owners = __velarGraphWeakMapRead(parents, target);
    // A mutation of an unowned value -- the overwhelmingly common case -- must
    // not pay for the cycle bookkeeping that only an ancestor walk needs.
    if (!owners) return;
    const visited = __velarGraphCreateSet();
    __velarGraphSetInsert(visited, target);
    const bubble = (current) => {
      if (__velarGraphSetContains(visited, current)) return;
      __velarGraphSetInsert(visited, current);
      bump(current);
      notify(current, deepKey);
      const next = __velarGraphWeakMapRead(parents, current);
      if (next) for (const owner of __velarGraphSetItems(next)) bubble(owner);
    };
    for (const owner of __velarGraphSetItems(owners)) bubble(owner);
  };
  const link = (child, parent) => {
    if (child === null || (typeof child !== "object" && typeof child !== "function")) return;
    linkOwner(toRaw(child), parent, true);
  };
  // 'structural' separates a slot being filled from a slot merely being read.
  // A read proves the child is in the parent right now; only a write adds an
  // occurrence, and only a write can create the duplicate the running count
  // cannot see for itself.
  const linkOwner = (child, parent, structural = false) => {
    parent = toRaw(parent);
    if (parent === null || (typeof parent !== "object" && typeof parent !== "function") || child === parent) return;
    let owners = __velarGraphWeakMapRead(parents, child);
    if (!owners) { owners = __velarGraphCreateSet(); __velarGraphWeakMapWrite(parents, child, owners); }
    const known = __velarGraphSetContains(owners, parent);
    __velarGraphSetInsert(owners, parent);
    const counts = __velarGraphWeakMapRead(containment, parent);
    if (!counts) return;
    if (structural && known) { __velarGraphWeakMapRemove(containment, parent); return; }
    if ((__velarGraphMapRead(counts, child) ?? 0) < 1) __velarGraphMapWrite(counts, child, 1);
  };
  // Removing the last owner of a value detaches everything only that value
  // owned. Without the cascade, replacing a state root leaves every surviving
  // descendant pointing at the dead root: the root stays strongly reachable
  // and each later deep mutation walks one more generation.
  const release = (root) => {
    const pending = [root];
    let index = 0;
    while (index < pending.length) {
      const current = pending[index];
      index += 1;
      forEachOwnedValue(current, (value) => {
        const owners = __velarGraphWeakMapRead(parents, value);
        if (!owners || !__velarGraphSetContains(owners, current)) return;
        __velarGraphSetRemove(owners, current);
        if (__velarGraphSetCount(owners) > 0) return;
        __velarGraphWeakMapRemove(parents, value);
        pending[pending.length] = value;
      });
    }
  };
  const unlink = (child, parent) => {
    child = toRaw(child);
    parent = toRaw(parent);
    const owners = child !== null && (typeof child === "object" || typeof child === "function")
      ? __velarGraphWeakMapRead(parents, child)
      : null;
    if (!owners) return;
    __velarGraphSetRemove(owners, parent);
    if (__velarGraphSetCount(owners) > 0) return;
    __velarGraphWeakMapRemove(parents, child);
    release(child);
  };
  // Map and Set membership is decided once per value and remembered: the only
  // cross-realm test JavaScript offers is invoking a prototype accessor and
  // catching, and a record write must not pay two thrown exceptions per field.
  const collectionBrand = (value) => {
    const known = __velarGraphWeakMapRead(collectionBrands, value);
    if (known !== undefined) return known;
    let brand = 0;
    try { __velarGraphMapCount(value); brand = 1; }
    catch {
      try { __velarGraphSetCount(value); brand = 2; }
      catch { brand = 0; }
    }
    __velarGraphWeakMapWrite(collectionBrands, value, brand);
    return brand;
  };
  const forEachOwnedValue = (parent, visit) => {
    if (parent === null || (typeof parent !== "object" && typeof parent !== "function")) return;
    if (__velarGraphIsList(parent)) {
      for (let index = 0; index < parent.length; index += 1) {
        const value = toRaw(__velarGraphOwnDescriptor(parent, index)?.value);
        if (value !== null && (typeof value === "object" || typeof value === "function")) visit(value);
      }
      return;
    }
    const brand = collectionBrand(parent);
    if (brand === 1) {
      for (const value of __velarGraphMapItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      // A Map key is linked to its Map exactly like a value, so releasing the
      // Map has to release object keys too.
      for (const value of __velarGraphMapKeyItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      return;
    }
    if (brand === 2) {
      for (const value of __velarGraphSetItems(parent)) {
        const owned = toRaw(value);
        if (owned !== null && (typeof owned === "object" || typeof owned === "function")) visit(owned);
      }
      return;
    }
    if (typeof parent !== "object") return;
    for (const name of __velarGraphOwnNames(parent)) {
      const descriptor = __velarGraphOwnDescriptor(parent, name);
      if (!descriptor || !("value" in descriptor)) continue;
      const value = toRaw(descriptor.value);
      if (value !== null && (typeof value === "object" || typeof value === "function")) visit(value);
    }
  };
  // Containment used to be re-derived by scanning the whole container on every
  // element write, which made one assignment into a rendered List cost O(list
  // length). The occurrence index answers the same question -- does the parent
  // still reference this child anywhere? -- in constant time: it is built once
  // from the container's real contents and then maintained by the same link and
  // release calls that change them.
  const containment = __velarGraphCreateWeakMap();
  const countOccurrence = (counts, value) => {
    value = toRaw(value);
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
    __velarGraphMapWrite(counts, value, (__velarGraphMapRead(counts, value) ?? 0) + 1);
  };
  // Mirrors exactly what the old scan looked at, Map keys included as owned
  // values are, so the index cannot answer a question the scan answered
  // differently.
  const buildContainment = (parent) => {
    const counts = __velarGraphCreateMap();
    if (__velarGraphIsList(parent)) {
      for (let index = 0; index < parent.length; index += 1) countOccurrence(counts, __velarGraphOwnDescriptor(parent, index)?.value);
      return counts;
    }
    const brand = collectionBrand(parent);
    if (brand === 1) {
      for (const value of __velarGraphMapItems(parent)) countOccurrence(counts, value);
      return counts;
    }
    if (brand === 2) {
      for (const value of __velarGraphSetItems(parent)) countOccurrence(counts, value);
      return counts;
    }
    if (!parent || typeof parent !== "object") return counts;
    for (const name of __velarGraphOwnNames(parent)) {
      const descriptor = __velarGraphOwnDescriptor(parent, name);
      if (descriptor && "value" in descriptor) countOccurrence(counts, descriptor.value);
    }
    return counts;
  };
  // The one guard every detach path shares: a primitive was never linked, and
  // an object with no owners has nothing to release, so neither may reach the
  // containment bookkeeping.
  const releaseChild = (parent, child) => {
    if (child === null || (typeof child !== "object" && typeof child !== "function")
      || !__velarGraphWeakMapContains(parents, child)) return;
    parent = toRaw(parent);
    if (parent === null || (typeof parent !== "object" && typeof parent !== "function")) return;
    child = toRaw(child);
    // A freshly built index already reflects the slot that was just cleared;
    // a maintained one still counts it, so only that one takes the decrement.
    let counts = __velarGraphWeakMapRead(containment, parent);
    let remaining;
    if (counts) remaining = (__velarGraphMapRead(counts, child) ?? 0) - 1;
    else {
      counts = buildContainment(parent);
      __velarGraphWeakMapWrite(containment, parent, counts);
      remaining = __velarGraphMapRead(counts, child) ?? 0;
    }
    if (remaining > 0) { __velarGraphMapWrite(counts, child, remaining); return; }
    __velarGraphMapRemove(counts, child);
    unlink(child, parent);
  };
  // The registry operation stays exactly two parameters wide; 'structural'
  // belongs to the internal call, which knows whether a slot is being filled or
  // merely read, and every caller outside this file fills one.
  const reactive = (value, parent = null) => reactiveValue(value, parent, true);
  const reactiveValue = (value, parent, structural) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    value = toRaw(value);
    if (parent !== null) linkOwner(value, parent, structural);
    if (typeof value !== "object" || __velarGraphIsList(value) || !__velarGraphIsExtensible(value)) return value;
    if (!__velarGraphIsRecord(value)) {
      // D114 P6 item 7 (ST-U4): the one place an unwrapped class instance is
      // handed back out of a state graph. In a development host its fields are
      // observed from here so a `computed` or `watch` that reads one is told
      // the read can never update; in a production build the detector's hooks
      // (stale-class.js) are null and this is one already-false test on the hot
      // path. The owner is handed over rather than the cell's name, because the
      // report names the path from the cell down to the instance.
      if (__velarStaleClassHooks !== null && parent !== null) __velarObserveClassFields(value, parent);
      return value;
    }
    let proxy = __velarGraphWeakMapRead(rawToProxy, value);
    if (proxy) return proxy;
    proxy = new __velarGraphNativeProxy(value, {
      get(target, key) {
        track(target, key);
        return reactiveValue(__velarGraphGet(target, key, target), target, false);
      },
      set(target, key, next) {
        next = toRaw(next);
        const present = __velarGraphHas(target, key);
        const previous = toRaw(__velarGraphGet(target, key, target));
        // Creating an absent key is a structural change even when the value
        // written equals the absent key's 'undefined' reading.
        const changed = !present || !__velarGraphSame(previous, next);
        const written = __velarGraphSet(target, key, next, target);
        if (!written || !changed) return written;
        link(next, target);
        releaseChild(target, previous);
        trigger(target, key, true, !present);
        return true;
      },
      has(target, key) { track(target, key); return __velarGraphHas(target, key); },
      deleteProperty(target, key) {
        if (!__velarGraphHas(target, key)) return true;
        const previous = toRaw(__velarGraphGet(target, key, target));
        const deleted = __velarGraphDelete(target, key);
        if (deleted) {
          releaseChild(target, previous);
          trigger(target, key, true, true);
        }
        return deleted;
      },
    });
    __velarGraphWeakMapWrite(rawToProxy, value, proxy);
    __velarGraphWeakMapWrite(proxyToRaw, proxy, value);
    return proxy;
  };
  const trackDeep = (value) => { value = toRaw(value); track(value, deepKey); return value; };
  const versionOf = (value) => {
    value = toRaw(value);
    return value && (typeof value === "object" || typeof value === "function")
      ? __velarGraphWeakMapRead(versions, value) ?? 0
      : 0;
  };
  const collectionRead = (value, key, child) => {
    value = toRaw(value);
    track(value, key);
    // Only containers already connected to a state graph own children read
    // through them. Fresh derived Lists (filter/map/etc.) stay ephemeral and
    // cannot become strongly retained parents of every item merely by being
    // iterated during rendering.
    return reactiveValue(child, __velarGraphWeakMapContains(parents, value) ? value : null, false);
  };
  const collectionTrigger = (value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) => trigger(toRaw(value), key, iterate, structure, indexFrom, allKeys);
  const collectionUnlink = (value, child) => {
    releaseChild(toRaw(value), toRaw(child));
  };
  const computed = (read) => {
    if (typeof read !== "function") throw new TypeError("computed requires a function");
    let dirty = true;
    let evaluating = false;
    let recursed = false;
    let initialized = false;
    let value;
    let failed = false;
    let failure;
    const subscribers = __velarGraphCreateSet();
    const notifyDependents = (skip = null) => {
      for (const dependent of __velarGraphSetItems(subscribers)) if (dependent !== skip) dependent.notify();
    };
    const invalidateComputedDependents = () => {
      for (const dependent of __velarGraphSetItems(subscribers)) {
        if (dependent.mode === "computed") dependent.notify();
      }
    };
    const observer = {
      mode: "computed",
      stopped: false,
      running: false,
      selfInvalidations: 0,
      // P2b-9: filled in by the graph's notify when a write lands while this
      // value is still being derived, so the runaway report names the path.
      selfInvalidationSubject: "",
      selfInvalidationKind: "",
      dependencies: __velarGraphCreateSet(),
      notify() {
        // Stopping is shared discipline with DOM and watch observers: a flush
        // overflow marks queued computed observers stopped, and a stopped
        // observer must go inert instead of re-entering the storm on the next
        // write.
        if (observer.stopped) return;
        // The 100 self-invalidation cap covers computed observers too. A
        // computed whose own turn (evaluation plus dependent notification)
        // keeps invalidating it is stopped with the same owned report a
        // render or watch observer gets, instead of running to the whole
        // flush budget.
        if (observer.running) {
          observer.selfInvalidations += 1;
          if (observer.selfInvalidations > 100) {
            observer.stopped = true;
            cleanupObserver(observer);
            reportUntracked(new RangeError("A computed value cannot invalidate itself more than 100 times"
              + (observer.selfInvalidationSubject ? ": it writes " + observer.selfInvalidationSubject + " while reading it" : "")));
            return;
          }
        } else {
          observer.selfInvalidations = 0;
        }
        if (dirty) return;
        dirty = true;
        if (__velarGraphSetCount(subscribers) === 0) {
          cleanupObserver(observer);
          return;
        }
        schedule(observer);
        // A downstream computed must become dirty immediately so a same-turn
        // read cannot observe its cached result while an upstream dependency
        // is already stale. DOM and watch observers still wait for evaluation
        // to prove that the public result actually changed.
        invalidateComputedDependents();
      },
      run() {
        if (observer.stopped || !dirty || __velarGraphSetCount(subscribers) === 0) return;
        observer.running = true;
        try {
          if (evaluate(false)) notifyDependents();
        } finally { observer.running = false; }
      },
    };
    const detach = () => {
      cleanupObserver(observer);
      dirty = true;
    };
    __velarGraphWeakMapWrite(subscriptionStops, subscribers, detach);
    const evaluate = (throwFailure) => {
      if (evaluating) {
        recursed = true;
        throw new RangeError("A computed value cannot read itself recursively");
      }
      const previous = value;
      const previouslyFailed = failed;
      const previousFailure = failure;
      const hadValue = initialized;
      evaluating = true;
      recursed = false;
      failed = false;
      failure = undefined;
      try { value = runTracked(observer, read); }
      catch (error) { failed = true; failure = error; }
      finally {
        evaluating = false;
        initialized = true;
        dirty = false;
      }
      // A computed that failed because its own recursion guard tripped sits on
      // a dependency cycle. The failure is cached and served, but the cyclic
      // edges must not persist: two failed computeds that keep notifying each
      // other would otherwise ping-pong the next flush into the whole-flush
      // budget. Detaching unwinds the cycle (a peer whose last subscriber
      // leaves detaches with it) and a later read simply re-attempts.
      if (failed && recursed) detach();
      else if (__velarGraphSetCount(subscribers) === 0) detach();
      recursed = false;
      const changed = !hadValue || previouslyFailed !== failed || (failed ? previousFailure !== failure : !__velarGraphSame(previous, value));
      if (throwFailure && failed) throw failure;
      return changed;
    };
    const access = () => {
      const consumer = runtime.activeObserver;
      if (consumer !== observer) trackSubscribers(subscribers);
      if (dirty && !observer.stopped) {
        // A cyclic read re-enters access while the outer evaluation is still
        // running, so the running span is restored, never cleared.
        const wasRunning = observer.running;
        observer.running = true;
        try {
          const changed = evaluate(false);
          if (changed && initialized) notifyDependents(consumer);
        } finally { observer.running = wasRunning; }
      }
      if (failed) throw failure;
      return value;
    };
    return __velarGraphFreeze(access);
  };
  // The loud channel for a failure nothing owns.
  //
  // D114 P6 item 4 (LC-C1) and F9-web (WB-C1): every `tick()` waiting on the
  // flush is a claimant, in every host. A caller waiting on the flush is the
  // one place a failure nobody handled can be delivered *to somebody*, so the
  // flush's first unowned failure is parked and every pending `tick()` rejects
  // with it -- the promise that awaiting `tick()` cannot step over a broken
  // update is one the second concurrent awaiter has to keep too.
  //
  // Everything else goes to the host, and there is no second channel beside a
  // claimant: a later failure in the same flush, whose claimants are already
  // spoken for, and every failure raised with nobody waiting at all. In a
  // browser that is the microtask throw the host error event catches and the
  // page survives; in a non-browser host (a headless 'velar test' process, a
  // worker) the same throw would terminate the process, which the runtime
  // boundary forbids, so there it is traced to the report channel. Nothing is
  // parked for a `tick()` that is not yet waiting, because a caller who arrives
  // after the flush was never waiting on it.
  const escalate = (error) => {
    if (__velarTickWaiting() && __velarGraphSetCount(unhandledFailures) === 0) {
      __velarGraphSetInsert(unhandledFailures, error);
      return;
    }
    if (__velarDomDocument !== null) {
      __velarEnqueue(() => { throw error; });
      return;
    }
    __velarFoundationTrace(error);
  };
  const report = (value, options) => {
    const error = __velarNormalizeError(value);
    const checked = __velarReportOptions(options);
    const timestamp = __velarNow();
    if (!__velarWebErrorFinite(timestamp)) throw new TypeError("The browser returned an invalid error timestamp");
    const errorReport = __velarWebErrorFreeze({
      error,
      phase: checked.phase,
      detail: checked.detail,
      component: checked.component,
      timestamp,
    });
    let handled = false;
    for (const handler of __velarGraphSetItems(errorHandlers)) {
      handled = true;
      try {
        const result = handler(errorReport);
        __velarObservePromise(result, (failure) => escalate(__velarNormalizeError(failure)));
      } catch (failure) { escalate(__velarNormalizeError(failure)); }
    }
    if (checked.unhandled && !handled) escalate(error);
    return errorReport;
  };
  // A report raised from inside a tracked evaluation (the computed cap) must
  // not let handler reads become dependencies of the failing observer.
  const reportUntracked = (error) => {
    const previousObserver = runtime.activeObserver;
    runtime.activeObserver = null;
    try { report(error, { phase: "update", detail: "", component: "", unhandled: true }); }
    finally { runtime.activeObserver = previousObserver; }
  };
  // The queue insert stays on the registry -- computed observers are created by
  // whichever module stamped it first (velar/app under ESM import order, or the
  // application prelude) and must schedule correctly whichever that was -- but
  // the drain it calls is the module-scope one below, and there is now exactly
  // one of those. A queue that outgrows its bound is the flush budget's failure
  // to own, not an exception thrown out of the assignment that happened to
  // cross the line: throwing here left the writing cell's subscriber walk half
  // finished, with the remaining observers subscribed and never notified again.
  const schedule = (observer) => {
    __velarGraphSetInsert(observer.mode === "watch" ? watchQueue : domQueue, observer);
    __velarScheduleFlush();
  };
  const applyLook = (...arguments_) => {
    if (!lookImplementation) throw new TypeError("Link Look requires the VelarScript Web runtime");
    return lookImplementation(...arguments_);
  };
  const installLook = (implementation) => {
    if (typeof implementation !== "function") throw new TypeError("VelarScript Look integration requires a function");
    lookImplementation ??= implementation;
    return null;
  };
  const fields = {
    version: "0.12", domQueue, watchQueue, flushPending: false, activeObserver: null, errorHandlers,
    actionFailures, unhandledFailures, lookSources, classSources, dependencies, rawToProxy, proxyToRaw, versions, parents,
    toRaw, reactive, track, trackDeep, trigger, versionOf, collectionRead, collectionTrigger, collectionUnlink,
    trackSubscribers, runTracked, cleanupObserver, computed,
    schedule, report, applyLook, installLook,
  };
  for (const name of __velarRuntimeFields) Object.defineProperty(runtime, name, {
    value: fields[name],
    enumerable: false,
    configurable: false,
    writable: name === "flushPending" || name === "activeObserver",
  });
  return Object.preventExtensions(runtime);
}

function __velarRequireRuntime(value) {
  if (!value || typeof value !== "object") throw new TypeError("VelarScript Web runtime ownership is invalid");
  // The schema comparison comes first, ahead of ownership and the field roster:
  // a schema bump normally changes the roster too, so leaving it last reported
  // "fields are invalid" and never named the one fact that identifies the
  // cause. The version is read through its descriptor rather than the property
  // so an unvalidated object cannot answer it with a getter.
  const __velarVersionDescriptor = Object.getOwnPropertyDescriptor(value, "version");
  const __velarVersion = __velarVersionDescriptor && "value" in __velarVersionDescriptor ? __velarVersionDescriptor.value : undefined;
  if (__velarVersion !== "0.12") {
    throw new TypeError("VelarScript Web runtime schema " + (typeof __velarVersion === "string" ? __velarVersion : "(unknown)") + " does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  if (Object.getPrototypeOf(value) !== null || Object.isExtensible(value)
    || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("VelarScript Web runtime ownership is invalid");
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== __velarRuntimeFields.length || __velarRuntimeFields.some((name) => !names.includes(name))) {
    throw new TypeError("VelarScript Web runtime fields are invalid");
  }
  for (const name of __velarRuntimeFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    const mutable = name === "flushPending" || name === "activeObserver";
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable !== mutable) {
      throw new TypeError("VelarScript Web runtime field '" + name + "' is invalid");
    }
  }
  if (!__velarRuntimeCollection(value.domQueue, "Set") || !__velarRuntimeCollection(value.watchQueue, "Set")
    || typeof value.flushPending !== "boolean" || (value.activeObserver !== null && typeof value.activeObserver !== "object")
    || !__velarRuntimeCollection(value.errorHandlers, "Set") || !__velarRuntimeCollection(value.actionFailures, "WeakSet")
    || !__velarRuntimeCollection(value.unhandledFailures, "Set")
    || !__velarRuntimeCollection(value.lookSources, "WeakMap") || !__velarRuntimeCollection(value.classSources, "WeakMap")
    || !__velarRuntimeCollection(value.dependencies, "WeakMap") || !__velarRuntimeCollection(value.rawToProxy, "WeakMap")
    || !__velarRuntimeCollection(value.proxyToRaw, "WeakMap") || !__velarRuntimeCollection(value.versions, "WeakMap")
    || !__velarRuntimeCollection(value.parents, "WeakMap")
    || typeof value.toRaw !== "function" || typeof value.reactive !== "function" || typeof value.track !== "function"
    || typeof value.trackDeep !== "function" || typeof value.trigger !== "function" || typeof value.versionOf !== "function"
    || typeof value.collectionRead !== "function" || typeof value.collectionTrigger !== "function" || typeof value.collectionUnlink !== "function"
    || typeof value.trackSubscribers !== "function" || typeof value.runTracked !== "function"
    || typeof value.cleanupObserver !== "function" || typeof value.computed !== "function" || typeof value.schedule !== "function"
    || typeof value.report !== "function" || typeof value.applyLook !== "function" || typeof value.installLook !== "function") {
    throw new TypeError("VelarScript Web runtime values are invalid");
  }
  return value;
}

const __velarRuntime = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
      throw new TypeError("VelarScript Web runtime registry ownership is invalid");
    }
    return __velarRequireRuntime(descriptor.value);
  }
  const runtime = __velarCreateRuntime();
  Object.defineProperty(globalThis, __velarRuntimeKey, {
    value: runtime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return runtime;
})();
