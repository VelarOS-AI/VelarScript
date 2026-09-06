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
function __velarFoundationTrace(error) {
  if (typeof __velarFoundationConsoleError !== "function" || typeof __velarFoundationReflectApply !== "function") return;
  let trace = "An unhandled VelarScript failure was reported";
  try { const stack = error.stack; if (typeof stack === "string" && stack !== "") trace = stack; } catch {}
  if (trace === "An unhandled VelarScript failure was reported") {
    try { const message = error.message; if (typeof message === "string" && message !== "") trace = message; } catch {}
  }
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

