import { VELAR_ERROR_NORMALIZATION_RUNTIME } from "@velarscript/compiler/extension";

export const WEB_RUNTIME_FOUNDATION = String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const __velarRuntimeKey = Symbol.for("velar.runtime.v1");
const __velarRuntimeFields = Object.freeze([
  "version", "domQueue", "watchQueue", "flushPending", "activeObserver", "errorHandlers",
  "actionFailures", "lookSources", "classSources", "report", "applyLook", "installLook",
]);

function __velarRuntimeCollection(value, kind) {
  try {
    if (kind === "Set") Set.prototype.has.call(value, value);
    else if (kind === "WeakSet") WeakSet.prototype.has.call(value, value);
    else WeakMap.prototype.has.call(value, value);
    return true;
  } catch { return false; }
}

function __velarReportOptions(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("VelarScript error report options must be a record");
  }
  const allowed = new Set(["phase", "detail", "component", "unhandled"]);
  const output = { phase: "runtime", detail: "", component: "", unhandled: false };
  for (const name of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(name)) throw new TypeError("Unknown VelarScript error report option '" + name + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
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

function __velarCreateRuntime() {
  const runtime = Object.create(null);
  const domQueue = Object.freeze(new Set());
  const watchQueue = Object.freeze(new Set());
  const errorHandlers = Object.freeze(new Set());
  const actionFailures = Object.freeze(new WeakSet());
  const lookSources = Object.freeze(new WeakMap());
  const classSources = Object.freeze(new WeakMap());
  let lookImplementation = null;
  const report = (value, options) => {
    const error = __velarNormalizeError(value);
    const checked = __velarReportOptions(options);
    const timestamp = globalThis.Date.now();
    if (!Number.isFinite(timestamp)) throw new TypeError("The browser returned an invalid error timestamp");
    const errorReport = Object.freeze({
      error,
      phase: checked.phase,
      detail: checked.detail,
      component: checked.component,
      timestamp,
    });
    let handled = false;
    for (const handler of Set.prototype.values.call(errorHandlers)) {
      handled = true;
      try {
        const result = handler(errorReport);
        if (result && typeof result.then === "function") result.catch((failure) => queueMicrotask(() => { throw __velarNormalizeError(failure); }));
      } catch (failure) { queueMicrotask(() => { throw __velarNormalizeError(failure); }); }
    }
    if (checked.unhandled && !handled) queueMicrotask(() => { throw error; });
    return errorReport;
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
    version: "0.10", domQueue, watchQueue, flushPending: false, activeObserver: null, errorHandlers,
    actionFailures, lookSources, classSources, report, applyLook, installLook,
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
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== null || Object.isExtensible(value)
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
  if (value.version !== "0.10"
    || !__velarRuntimeCollection(value.domQueue, "Set") || !__velarRuntimeCollection(value.watchQueue, "Set")
    || typeof value.flushPending !== "boolean" || (value.activeObserver !== null && typeof value.activeObserver !== "object")
    || !__velarRuntimeCollection(value.errorHandlers, "Set") || !__velarRuntimeCollection(value.actionFailures, "WeakSet")
    || !__velarRuntimeCollection(value.lookSources, "WeakMap") || !__velarRuntimeCollection(value.classSources, "WeakMap")
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
`.trimStart();
