
export function onError(handler) {
  if (typeof handler !== "function") throw new TypeError("onError requires a callback");
  if (!__velarGraphSetContains(__velarRuntime.errorHandlers, handler) && __velarGraphSetCount(__velarRuntime.errorHandlers) >= 1000) throw new RangeError("An application cannot install more than 1000 error handlers");
  __velarGraphSetInsert(__velarRuntime.errorHandlers, handler);
  return () => { __velarGraphSetRemove(__velarRuntime.errorHandlers, handler); return null; };
}

export function reportError(error, phase = "manual", detail = "") {
  if (!__velarIsError(error)) throw new TypeError("reportError requires an Error");
  if (typeof phase !== "string" || typeof detail !== "string") throw new TypeError("reportError phase and detail must be strings");
  if (phase.length > 256 || detail.length > 65536) throw new RangeError("reportError phase/detail text is too long");
  __velarRuntime.report(error, { phase, detail, unhandled: false });
  return null;
}
