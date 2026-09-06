function __velarReport(value, phase, scope = null, detail = "", unhandled = true) {
  return __velarRuntime.report(value, { phase, detail, component: scope ? scope.component : "", unhandled });
}

function __velarReportEvent(value, scope, detail) {
  if (__velarIsError(value) && __velarGraphWeakSetRemove(__velarRuntime.actionFailures, value)) return null;
  return __velarReport(value, "event", scope, detail);
}

const __velarWebIterateKey = Symbol.for("velar.reactive.iterate.v1");
const __velarWebNativeJson = globalThis.JSON;
const __velarWebJsonText = Object.getOwnPropertyDescriptor(__velarWebNativeJson, "stringify")?.value;
const __velarEventReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarEventConstructorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Event");
const __velarEventConstructor = __velarEventConstructorDescriptor && "value" in __velarEventConstructorDescriptor ? __velarEventConstructorDescriptor.value : null;
const __velarEventPrototype = typeof __velarEventConstructor === "function" ? Object.getOwnPropertyDescriptor(__velarEventConstructor, "prototype")?.value : null;
const __velarEventTargetGetter = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "target")?.get;
const __velarEventPreventDefault = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "preventDefault")?.value;
const __velarEventStopPropagation = __velarEventPrototype && Object.getOwnPropertyDescriptor(__velarEventPrototype, "stopPropagation")?.value;
const __velarEventMissingField = __velarGraphFreeze({});
function __velarQuotedText(value) {
  return __velarGraphApply(__velarWebJsonText, __velarWebNativeJson, [value], "JSON.stringify");
}
function __velarAppendOwned(values, value) {
  values[values.length] = value;
  return value;
}
function __velarHasName(values, name) {
  for (let index = 0; index < values.length; index += 1) if (values[index] === name) return true;
  return false;
}
function __velarEventField(value, name, nativeGetter) {
  if (typeof nativeGetter === "function" && typeof __velarEventReflectApply === "function") {
    try { return __velarEventReflectApply(nativeGetter, value, []); } catch {}
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return __velarEventMissingField;
  const descriptor = __velarGraphOwnDescriptor(value, name);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : __velarEventMissingField;
}
function __velarEventCall(value, name, nativeMethod) {
  if (typeof nativeMethod === "function" && typeof __velarEventReflectApply === "function") {
    try { return __velarEventReflectApply(nativeMethod, value, []); } catch {}
  }
  const method = __velarEventField(value, name, null);
  if (typeof method !== "function" || typeof __velarEventReflectApply !== "function") throw new TypeError("DOM event does not expose native " + name);
  return __velarEventReflectApply(method, value, []);
}

