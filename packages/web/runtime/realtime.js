const maxRealtimeTextCodeUnits = 16 * 1024 * 1024;
const maxRealtimeUrlCodeUnits = 2 * 1024 * 1024;
const realtimeMissingField = Object.freeze({});
const realtimeReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
function realtimeGlobalConstructor(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "function" ? descriptor.value : null;
}
function realtimePrototype(value) {
  return typeof value === "function" ? Object.getOwnPropertyDescriptor(value, "prototype")?.value : null;
}
function realtimePrototypeMember(prototype, name, kind) {
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
const RealtimeEventSource = realtimeGlobalConstructor("EventSource");
const realtimeEventSourcePrototype = realtimePrototype(RealtimeEventSource);
const realtimeEventSourceAddEventListener = realtimePrototypeMember(realtimeEventSourcePrototype, "addEventListener", "value");
const realtimeEventSourceClose = realtimePrototypeMember(realtimeEventSourcePrototype, "close", "value");
const realtimeEventSourceUrl = realtimePrototypeMember(realtimeEventSourcePrototype, "url", "get");
const realtimeEventSourceReadyState = realtimePrototypeMember(realtimeEventSourcePrototype, "readyState", "get");
const realtimeMessageEventPrototype = realtimePrototype(realtimeGlobalConstructor("MessageEvent"));
const realtimeMessageEventData = realtimePrototypeMember(realtimeMessageEventPrototype, "data", "get");
const realtimeMessageEventLastEventId = realtimePrototypeMember(realtimeMessageEventPrototype, "lastEventId", "get");
function realtimeOwnDataField(value, name) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return realtimeMissingField;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : realtimeMissingField;
}
function realtimeHostField(value, name, nativeGetter) {
  if (typeof nativeGetter === "function" && typeof realtimeReflectApply === "function") {
    try { return realtimeReflectApply(nativeGetter, value, []); } catch {}
  }
  return realtimeOwnDataField(value, name);
}
function realtimeCall(operation, receiver, arguments_, name) {
  if (typeof operation !== "function" || typeof realtimeReflectApply !== "function") throw new TypeError("The browser does not expose native " + name);
  return realtimeReflectApply(operation, receiver, arguments_);
}
function realtimeUrl(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeUrlCodeUnits) throw new RangeError(name + " cannot exceed 2 MiB");
  return value;
}
function handler(value, allowed) {
  value = __velarOptions(value, "Realtime handlers", allowed);
  for (const name of Object.getOwnPropertyNames(value)) {
    const callback = Object.getOwnPropertyDescriptor(value, name).value;
    if (callback != null && typeof callback !== "function") throw new TypeError("Realtime handler '" + name + "' must be callable");
  }
  return value;
}
function eventStreamState(value) {
  const readyState = realtimeHostField(value, "readyState", realtimeEventSourceReadyState);
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closed";
  throw new TypeError("Event stream returned an invalid state");
}
export function eventStream(url, handlers = {}, credentials = false) {
  handlers = handler(handlers, __velarOptionFields(["open", "message", "error"]));
  credentials = __velarBool(credentials, "Event stream credentials");
  if (!RealtimeEventSource) throw new TypeError("The browser does not expose native EventSource");
  const value = new RealtimeEventSource(realtimeUrl(url, "Event stream URL"), { withCredentials: credentials });
  let resolvedUrl;
  try {
    const hostUrl = realtimeHostField(value, "url", realtimeEventSourceUrl);
    if (hostUrl === realtimeMissingField) throw new TypeError("Event stream returned an invalid resolved URL");
    resolvedUrl = realtimeUrl(hostUrl, "Event stream resolved URL");
  }
  catch (failure) { try { realtimeCall(realtimeEventSourceClose, value, [], "EventSource close"); } catch {} throw failure; }
  const opened = () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "event-stream:open");
  const messaged = (event) => {
    const data = realtimeHostField(event, "data", realtimeMessageEventData);
    const lastEventId = realtimeHostField(event, "lastEventId", realtimeMessageEventLastEventId);
    if (data === realtimeMissingField || lastEventId === realtimeMissingField) {
      __velarReportOwnedCallback(new TypeError("Event stream message event is invalid"), "realtime", "event-stream:message");
      try { realtimeCall(realtimeEventSourceClose, value, [], "EventSource close"); } catch {}
      return;
    }
    if (typeof data !== "string" || data.length > maxRealtimeTextCodeUnits || typeof lastEventId !== "string" || lastEventId.length > 65536) {
      __velarInvokeOwnedCallback(handlers.error, ["Event stream message or ID exceeded VelarScript limits"], "realtime", "event-stream:error");
      realtimeCall(realtimeEventSourceClose, value, [], "EventSource close");
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [data, lastEventId], "realtime", "event-stream:message");
  };
  const failed = () => __velarInvokeOwnedCallback(handlers.error, ["Event stream connection error"], "realtime", "event-stream:error");
  try {
    realtimeCall(realtimeEventSourceAddEventListener, value, ["open", opened], "EventSource event listener");
    realtimeCall(realtimeEventSourceAddEventListener, value, ["message", messaged], "EventSource event listener");
    realtimeCall(realtimeEventSourceAddEventListener, value, ["error", failed], "EventSource event listener");
  } catch (failure) {
    try { realtimeCall(realtimeEventSourceClose, value, [], "EventSource close"); } catch {}
    throw failure;
  }
  return Object.freeze({
    url: resolvedUrl,
    state: () => eventStreamState(value),
    close() { realtimeCall(realtimeEventSourceClose, value, [], "EventSource close"); return null; },
  });
}
