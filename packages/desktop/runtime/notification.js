const maxNotificationTitle = 256;
const maxNotificationBody = 1024;
const maxNotificationTag = 128;
const notificationFields = new Set(["title", "body", "tag"]);
const activationFields = new Set(["tag"]);
function requireNotificationDeclaration(operation) {
  if (notificationsDeclared) return;
  throw new Error(operation + " requires 'notifications: true' under 'desktop.permissions' in this project's velar.json");
}
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
function notificationText(value, field, maximum) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("show " + field + " must be non-empty text");
  if (value.length > maximum || value.includes("\0")) throw new RangeError("show " + field + " cannot exceed " + maximum + " characters");
  return value;
}
function notificationTag(value, operation) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " tag must be non-empty text");
  if (value.length > maxNotificationTag || value.includes("\0")) throw new RangeError(operation + " tag cannot exceed " + maxNotificationTag + " characters");
  return value;
}
function activationOf(value) {
  const fields = recordOf(value, "Desktop notification activation", activationFields);
  if (Reflect.ownKeys(fields).length !== 1) throw new TypeError("Desktop host returned an invalid notification activation");
  return Object.freeze({tag: notificationTag(fields.tag, "activations")});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("notification", operation, args, timeout);
}
export const NotificationPermission = __velarRegisterRuntimeType(Object.freeze({
  granted: "granted", denied: "denied", undetermined: "undetermined",
  is(value) { return value === "granted" || value === "denied" || value === "undetermined"; },
  parse(value) {
    if (!NotificationPermission.is(value)) throw new TypeError("Value does not match NotificationPermission");
    return value;
  },
  values() { return ["granted", "denied", "undetermined"]; },
}));
export const NotificationActivation = Object.freeze({
  is(value) { try { activationOf(value); return true; } catch { return false; } },
  parse(value) { return activationOf(value); },
});
class NotificationActivationStreamHandle {
  constructor(token, handle) {
    if (token !== notificationStreamToken) throw new TypeError("NotificationActivationStream values are created only by velar/notification.activations");
    if (!Number.isSafeInteger(handle) || handle < 1) throw new TypeError("Desktop host returned an invalid notification activation stream handle");
    this.handle = handle;
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error("NotificationActivationStream.next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke("watchNext", [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return activationOf(value);
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
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid notification activation stream release result");
    return null;
  }
}
export const NotificationActivationStream = Object.freeze({
  is(value) { return value instanceof NotificationActivationStreamHandle; },
  parse(value) {
    if (!(value instanceof NotificationActivationStreamHandle)) throw new TypeError("Value does not match NotificationActivationStream");
    return value;
  },
});
export async function requestPermission() {
  requireNotificationDeclaration("requestPermission");
  return NotificationPermission.parse(await invoke("requestPermission", [], 0));
}
export async function show(notification) {
  requireNotificationDeclaration("show");
  const fields = recordOf(notification, "show notification", notificationFields);
  const value = await invoke("show", [{
    title: notificationText(fields.title, "title", maxNotificationTitle),
    body: notificationText(fields.body, "body", maxNotificationBody),
    tag: notificationTag(fields.tag, "show"),
  }]);
  if (value !== null) throw new TypeError("Desktop host returned an invalid show result");
  return null;
}
export async function activations() {
  requireNotificationDeclaration("activations");
  return new NotificationActivationStreamHandle(notificationStreamToken, await invoke("watchStart", []));
}
