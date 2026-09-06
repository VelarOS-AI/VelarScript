const appBase = "__VELAR_WEB_BASE__";
let nextDomId = 1;
function webLocationField(name, getter) {
  return __velarBrowserField(__velarBrowserLocation, name, getter, __velarBrowserLocationConstructor);
}
function webUrl(value, base) {
  if (typeof __velarBrowserUrlConstructor !== "function") throw new TypeError("The browser URL API is unavailable");
  return new __velarBrowserUrlConstructor(value, base);
}
function webUrlField(value, name, getter) {
  return __velarBrowserField(value, name, getter, __velarBrowserUrlConstructor);
}
const webEventMissingField = Object.freeze({});
const webEventReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
function webEventConstructor(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "function" ? descriptor.value : null;
}
function webEventPrototypeMember(constructor, name, kind) {
  let prototype = typeof constructor === "function" ? Object.getOwnPropertyDescriptor(constructor, "prototype")?.value : null;
  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor) {
      const member = kind === "get" ? descriptor.get : "value" in descriptor ? descriptor.value : null;
      return typeof member === "function" ? member : null;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return null;
}
const webNativeEvent = webEventConstructor("Event");
const webNativeMouseEvent = webEventConstructor("MouseEvent");
const webEventDefaultPrevented = webEventPrototypeMember(webNativeEvent, "defaultPrevented", "get");
const webEventPreventDefault = webEventPrototypeMember(webNativeEvent, "preventDefault", "value");
const webEventButton = webEventPrototypeMember(webNativeMouseEvent, "button", "get");
const webEventMetaKey = webEventPrototypeMember(webNativeMouseEvent, "metaKey", "get");
const webEventCtrlKey = webEventPrototypeMember(webNativeMouseEvent, "ctrlKey", "get");
const webEventShiftKey = webEventPrototypeMember(webNativeMouseEvent, "shiftKey", "get");
const webEventAltKey = webEventPrototypeMember(webNativeMouseEvent, "altKey", "get");
function webEventField(event, name, nativeGetter) {
  if (typeof nativeGetter === "function" && typeof webEventReflectApply === "function") {
    try { return webEventReflectApply(nativeGetter, event, []); } catch {}
  }
  if (event === null || (typeof event !== "object" && typeof event !== "function")) return webEventMissingField;
  const descriptor = Object.getOwnPropertyDescriptor(event, name);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : webEventMissingField;
}
function webEventCall(event, name, nativeMethod) {
  if (typeof nativeMethod === "function" && typeof webEventReflectApply === "function") {
    try { return webEventReflectApply(nativeMethod, event, []); } catch {}
  }
  const method = webEventField(event, name, null);
  if (typeof method !== "function" || typeof webEventReflectApply !== "function") throw new TypeError("Link received an invalid click event");
  return webEventReflectApply(method, event, []);
}
function reportLinkEventFailure(failure) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (runtime && typeof runtime.report === "function") runtime.report(error, { phase: "event", detail: "link", unhandled: true });
  else __velarBrowserCallCaptured(__velarBrowserQueueMicrotask, __velarBrowserWindow, [() => { throw error; }], "queueMicrotask");
}

