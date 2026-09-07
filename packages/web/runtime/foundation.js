const __velarRuntimeKey = Symbol.for("velar.runtime.v1");
const __velarFoundationReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarFoundationQueueMicrotask = globalThis.queueMicrotask;
const __velarFoundationSetTimeout = globalThis.setTimeout;
const __velarFoundationDate = globalThis.Date;
const __velarFoundationDateNow = typeof __velarFoundationDate === "function"
  ? Object.getOwnPropertyDescriptor(__velarFoundationDate, "now")?.value
  : null;
const __velarFoundationConsole = globalThis.console ?? null;
const __velarFoundationConsoleError = __velarFoundationConsole !== null
  ? Object.getOwnPropertyDescriptor(__velarFoundationConsole, "error")?.value ?? null
  : null;
// D114 WB-D1 (CO-I6 on the Web face): the host-frame policy has one
// implementation, `__velarHostErrorTrace` in packages/compiler/runtime/error.js,
// and this is one of its callers rather than a third writer of the same
// sentence. Reading `error.stack` here printed exactly the two classes of frame
// that policy exists to hide -- the runtime's own `__velar` helpers and Node's
// internals -- with no "(N frames hidden; ...)" line and no answer to
// `velar run --stack`, which is the launcher path's promise repeated on a
// channel that did not keep it. The message-only fallback this used to spell a
// second time is that function's own second answer.
//
// The name arrives with the error-normalization runtime: an inlined Web program
// carries it in `WEB_ERROR_HOST_RUNTIME`, and a project build imports it beside
// `normalizeError` (packages/web/src/emit/runtime-imports.ts).
function __velarFoundationTrace(error) {
  if (typeof __velarFoundationConsoleError !== "function" || typeof __velarFoundationReflectApply !== "function") return;
  let trace = "An unhandled VelarScript failure was reported";
  try { trace = __velarHostErrorTrace(error, trace); } catch {}
  try { __velarFoundationReflectApply(__velarFoundationConsoleError, __velarFoundationConsole, ["Unhandled VelarScript error report: " + trace]); } catch {}
}
function __velarEnqueue(callback) {
  if (typeof __velarFoundationQueueMicrotask !== "function" || typeof __velarFoundationReflectApply !== "function") {
    throw new TypeError("The browser queueMicrotask API is unavailable");
  }
  return __velarFoundationReflectApply(__velarFoundationQueueMicrotask, globalThis, [callback]);
}
function __velarNow() {
  if (typeof __velarFoundationDateNow !== "function" || typeof __velarFoundationReflectApply !== "function") {
    throw new TypeError("The browser Date.now API is unavailable");
  }
  return __velarFoundationReflectApply(__velarFoundationDateNow, __velarFoundationDate, []);
}
const __velarRuntimeFields = Object.freeze([
  "version", "domQueue", "watchQueue", "flushPending", "activeObserver", "errorHandlers",
  "actionFailures", "unhandledFailures", "lookSources", "classSources", "dependencies", "rawToProxy", "proxyToRaw",
  "versions", "parents", "toRaw", "reactive", "track", "trackDeep", "trigger", "versionOf",
  "collectionRead", "collectionTrigger", "collectionUnlink", "trackSubscribers", "runTracked", "cleanupObserver", "computed",
  "schedule", "report", "applyLook", "installLook",
]);

function __velarRuntimeCollection(value, kind) {
  try {
    if (kind === "Set") __velarGraphSetContains(value, value);
    else if (kind === "WeakSet") __velarGraphWeakSetContains(value, value);
    else __velarGraphWeakMapContains(value, value);
    return true;
  } catch { return false; }
}

function __velarReportOptions(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || __velarGraphIsList(value) || !__velarGraphIsRecord(value)
    || __velarWebErrorOwnSymbols(value).length > 0) {
    throw new TypeError("VelarScript error report options must be a record");
  }
  const allowed = __velarGraphCreateSet(["phase", "detail", "component", "unhandled"]);
  const output = { phase: "runtime", detail: "", component: "", unhandled: false };
  for (const name of __velarGraphOwnNames(value)) {
    if (!__velarGraphSetContains(allowed, name)) throw new TypeError("Unknown VelarScript error report option '" + name + "'");
    const descriptor = __velarGraphOwnDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("VelarScript error report options cannot use accessors");
    const next = descriptor.value;
    if (name === "unhandled") {
      if (typeof next !== "boolean") throw new TypeError("VelarScript error report unhandled must be bool");
      output.unhandled = next;
    } else {
      if (typeof next !== "string") throw new TypeError("VelarScript error report " + name + " must be a string");
      const maximum = name === "phase" ? 256 : name === "component" ? 1024 : 65536;
      if (next.length > maximum) throw new RangeError("VelarScript error report " + name + " is too long");
      output[name] = next;
    }
  }
  return output;
}

// D90 R21: the number stamped on each observer when it is created, and the
// order the flush runs the watch tier in -- execution order is the order the
// author wrote the watches, and "wrote" spans more than one file: watches of
// one module register as that module initializes, instances of one component
// register as they mount, and modules register in the order the import graph
// initializes them. Every one of those is registration order, so one counter
// answers all three.
//
// It has to be application-wide, not per module. Each emitted module carries
// its own copy of this runtime, so a module-scope counter would restart at zero
// in the second module and the two modules' watches would compare equal. The
// counter therefore lives on one global slot every copy reads, the same way the
// runtime registry itself does.
const __velarObserverSequenceKey = Symbol.for("velar.web.observer.sequence.v1");
const __velarObserverSequenceCell = (() => {
  const descriptor = __velarGraphOwnDescriptor(globalThis, __velarObserverSequenceKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable
      || !__velarGraphIsList(descriptor.value)) {
      throw new TypeError("VelarScript Web observer sequence ownership is invalid");
    }
    return descriptor.value;
  }
  const cell = [0];
  __velarGraphDefine(globalThis, __velarObserverSequenceKey, {
    value: cell,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return cell;
})();

function __velarNextObserverSequence() {
  __velarObserverSequenceCell[0] += 1;
  return __velarObserverSequenceCell[0];
}


// D114 P6 item 4 (LC-C1): how many `tick()` promises are waiting on the flush
// right now.
//
// The charter says an unowned flush failure surfaces at `tick()`. That was only
// true off the browser: in a browser the runtime threw the failure from a
// microtask, which the host error event catches and the page survives, and the
// awaiting `tick()` resolved as though the update had been fine -- so
// `velar/web-test` stepped silently over a broken update in the one host
// `tick()` is documented for. An awaiting caller is a claimant: when one is
// waiting, the failure is parked for it and it rejects; when none is, the
// failure goes to the host as before.
//
// The count lives on one global slot for the reason the observer sequence does:
// each emitted module carries its own copy of this runtime, the `tick()` that
// waits and the flush that fails can be in two of them, and a module-scope
// counter would let the second copy answer "nobody is waiting" while the first
// one is.
const __velarTickWaitKey = Symbol.for("velar.web.tick.waiters.v1");
const __velarTickWaitCell = (() => {
  const descriptor = __velarGraphOwnDescriptor(globalThis, __velarTickWaitKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable
      || !__velarGraphIsList(descriptor.value)) {
      throw new TypeError("VelarScript Web tick ownership is invalid");
    }
    return descriptor.value;
  }
  const cell = [0];
  __velarGraphDefine(globalThis, __velarTickWaitKey, {
    value: cell,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return cell;
})();

function __velarTickWaiting() {
  return __velarTickWaitCell[0] > 0;
}

function __velarEnterTickWait() {
  __velarTickWaitCell[0] += 1;
}

function __velarLeaveTickWait() {
  if (__velarTickWaitCell[0] > 0) __velarTickWaitCell[0] -= 1;
}
