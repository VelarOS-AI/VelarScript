const __velarOwnedReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarOwnedQueueMicrotask = globalThis.queueMicrotask;
function __velarOwnedEnqueue(callback) {
  if (typeof __velarOwnedQueueMicrotask !== "function" || typeof __velarOwnedReflectApply !== "function") {
    throw new TypeError("The browser queueMicrotask API is unavailable");
  }
  return __velarOwnedReflectApply(__velarOwnedQueueMicrotask, globalThis, [callback]);
}
function __velarReportOwnedCallback(failure, phase, detail) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (runtime && typeof runtime.report === "function") runtime.report(error, { phase, detail, unhandled: true });
  else __velarOwnedEnqueue(() => { throw error; });
}
function __velarInvokeOwnedCallback(callback, arguments_, phase, detail) {
  if (callback == null) return;
  try {
    const result = callback(...arguments_);
    __velarObservePromise(result, (failure) => __velarReportOwnedCallback(failure, phase, detail));
  } catch (failure) {
    __velarReportOwnedCallback(failure, phase, detail);
  }
}
function __velarInvokeOwnedRead(read, callback, phase, detail) {
  try { __velarInvokeOwnedCallback(callback, [read()], phase, detail); }
  catch (failure) { __velarReportOwnedCallback(failure, phase, detail); }
}
