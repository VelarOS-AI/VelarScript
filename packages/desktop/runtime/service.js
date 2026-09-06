// The host states these three again on its own side
// (packages/desktop/native/macos/VelarDesktopHost.swift) and the fake host a
// third time (packages/desktop/src/test-runtime.ts); the three must not drift.
const maxServiceMessageBytes = 8 * 1024 * 1024;
const maxServiceCloseReasonBytes = 123;
// A failure detail is a bounded tail of the service's own stderr. The bound is
// the host's, restated here because a record that arrived larger than the host
// promised is a host this module does not recognise.
const maxServiceDetailBytes = 4 * 1024;
const serviceCloseFields = new Set(["code", "reason"]);
const serviceEventFields = new Set(["name", "state", "detail"]);
function recordOf(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(name + " must be a plain record");
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(name + " fields must use string names");
    if (!allowed.has(key)) throw new TypeError(name + " has unknown field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function serviceNameOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("connect requires a service name declared in desktop.services");
  }
  if (!declaredServices.has(value)) {
    throw new Error("connect cannot reach the undeclared service '" + value
      + "'; declare it under 'desktop.services' in this project's velar.json (declared services: " + declaredServiceList + ")");
  }
  return value;
}
function serviceHandleOf(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Desktop host returned an invalid service handle");
  return value;
}
function closeInfoOf(value) {
  const fields = recordOf(value, "ServiceClose", serviceCloseFields);
  if (Reflect.ownKeys(fields).length !== 2 || !Number.isSafeInteger(fields.code) || typeof fields.reason !== "string") {
    throw new TypeError("Desktop host returned an invalid service close record");
  }
  return Object.freeze({code: fields.code, reason: fields.reason});
}
function eventOf(value) {
  const fields = recordOf(value, "ServiceStateEvent", serviceEventFields);
  if (Reflect.ownKeys(fields).length !== 3 || !declaredServices.has(fields.name)) {
    throw new TypeError("Desktop host reported a state for an undeclared service");
  }
  const state = ServiceState.parse(fields.state);
  // Null for every state but the two that failed at something, and bounded when
  // it is present: an unbounded diagnostic is a service's whole log arriving in
  // a state event.
  if (fields.detail !== null) {
    if (typeof fields.detail !== "string" || __velarUtf8ByteLength(fields.detail) > maxServiceDetailBytes) {
      throw new TypeError("Desktop host returned an invalid service failure detail");
    }
    if (state !== "failed" && state !== "restarting") {
      throw new TypeError("Desktop host attached a failure detail to the '" + state + "' state");
    }
  }
  return Object.freeze({name: fields.name, state, detail: fields.detail});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("service", operation, args, timeout);
}
export const ServiceState = __velarRegisterRuntimeType(Object.freeze({
  starting: "starting", ready: "ready", restarting: "restarting", failed: "failed", stopped: "stopped",
  is(value) {
    return value === "starting" || value === "ready" || value === "restarting" || value === "failed" || value === "stopped";
  },
  parse(value) {
    if (!ServiceState.is(value)) throw new TypeError("Value does not match ServiceState");
    return value;
  },
  values() { return ["starting", "ready", "restarting", "failed", "stopped"]; },
}));
export const ServiceClose = Object.freeze({
  is(value) { try { closeInfoOf(value); return true; } catch { return false; } },
  parse(value) { return closeInfoOf(value); },
});
export const ServiceStateEvent = Object.freeze({
  is(value) { try { eventOf(value); return true; } catch { return false; } },
  parse(value) { return eventOf(value); },
});
class ServiceConnectionHandle {
  constructor(token, handle, name) {
    if (token !== serviceToken) throw new TypeError("ServiceConnection values are created only by velar/service.connect");
    this.handle = serviceHandleOf(handle);
    this.name = name;
    this.released = false;
    this.pending = false;
    Object.seal(this);
  }
  async state() {
    const value = await invoke("state", [this.handle]);
    if (value !== "open" && value !== "closed") throw new TypeError("Desktop host returned an invalid service connection state");
    return value;
  }
  // Backpressure is the host's answer rather than this module's: the call
  // settles when the frame has left, and a caller that never awaits it is told
  // so by name once its unsent messages reach the channel's bound.
  async send(message) {
    if (typeof message !== "string") throw new TypeError("ServiceConnection.send requires text");
    if (__velarUtf8ByteLength(message) > maxServiceMessageBytes) {
      throw new RangeError("ServiceConnection message cannot exceed 8 MiB");
    }
    const value = await invoke("send", [this.handle, message], 0);
    if (value !== null) throw new TypeError("Desktop host returned an invalid service send result");
    return null;
  }
  async next() {
    if (this.pending) throw new Error("ServiceConnection.next already has an active pull");
    this.pending = true;
    try {
      const value = await invoke("receive", [this.handle], 0);
      if (value === null) return null;
      if (typeof value !== "string") throw new TypeError("Desktop host returned an invalid service message");
      return value;
    } finally {
      this.pending = false;
    }
  }
  async closeInfo() { return closeInfoOf(await invoke("closeInfo", [this.handle])); }
  // Releasing a ServiceConnection closes it, and closing a closed channel is the
  // state it is already in, so the second call is not an error: the host answers
  // false for a handle it no longer holds.
  async close(code = 1000, reason = "") {
    if (!Number.isSafeInteger(code) || code < 1000 || code > 4999) throw new RangeError("Service close code must be from 1000 through 4999");
    if (typeof reason !== "string" || __velarUtf8ByteLength(reason) > maxServiceCloseReasonBytes) {
      throw new RangeError("Service close reason cannot exceed 123 UTF-8 bytes");
    }
    if (this.released) return null;
    this.released = true;
    const value = await invoke("close", [this.handle, code, reason]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid service release result");
    return null;
  }
}
class ServiceStateStreamHandle {
  constructor(token, handle) {
    if (token !== serviceStreamToken) throw new TypeError("ServiceStateStream values are created only by velar/service.watchServices");
    this.handle = serviceHandleOf(handle);
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error("ServiceStateStream.next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke("watchNext", [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return eventOf(value);
      } catch (error) {
        this.closed = true;
        try { await invoke("watchClose", [this.handle]); } catch {}
        throw error;
      } finally {
        this.pending = false;
      }
    };
    Object.seal(this);
  }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    const value = await invoke("watchClose", [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid service state stream release result");
    return null;
  }
}
export const ServiceConnection = Object.freeze({
  is(value) { return value instanceof ServiceConnectionHandle; },
  parse(value) { if (!(value instanceof ServiceConnectionHandle)) throw new TypeError("Value does not match ServiceConnection"); return value; },
});
export const ServiceStateStream = Object.freeze({
  is(value) { return value instanceof ServiceStateStreamHandle; },
  parse(value) { if (!(value instanceof ServiceStateStreamHandle)) throw new TypeError("Value does not match ServiceStateStream"); return value; },
});
export async function connect(name) {
  name = serviceNameOf(name);
  return new ServiceConnectionHandle(serviceToken, await invoke("connect", [name]), name);
}
export async function watchServices() {
  if (declaredServices.size === 0) {
    throw new Error("watchServices requires at least one service under 'desktop.services' in this project's velar.json");
  }
  return new ServiceStateStreamHandle(serviceStreamToken, await invoke("watchStart", []));
}
