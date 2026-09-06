const maxSecureStorageValueBytes = 8 * 1024;
function storageName(value, operation) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new TypeError(operation + " requires a name declared in desktop.permissions.secureStorage");
  }
  if (!declaredSecureStorageNames.has(value)) {
    throw new Error(operation + " cannot reach the undeclared secure storage name '" + value
      + "'; declare it under 'desktop.permissions.secureStorage' in this project's velar.json (declared names: " + declaredSecureStorageNameList + ")");
  }
  return value;
}
// A rejected value is described by its size and never by its content, here and
// in every message below.
function storageValue(value) {
  if (typeof value !== "string") throw new TypeError("set requires a text value");
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > maxSecureStorageValueBytes) throw new RangeError("set cannot store more than 8 KiB");
  return value;
}
function invoke(operation, args) {
  return __velarDesktopHostCall("secure-storage", operation, args, 30000);
}
export async function set(name, value) {
  const result = await invoke("set", [storageName(name, "set"), storageValue(value)]);
  if (result !== null) throw new TypeError("Desktop host returned an invalid secure storage set result");
  return null;
}
export async function get(name) {
  const value = await invoke("get", [storageName(name, "get")]);
  if (value === null) return null;
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > maxSecureStorageValueBytes) {
    throw new TypeError("Desktop host returned an invalid secure storage value");
  }
  return value;
}
// Removing what is not there is the state it is already in, so the second call
// is not an error.
export async function remove(name) {
  const result = await invoke("remove", [storageName(name, "remove")]);
  if (result !== null) throw new TypeError("Desktop host returned an invalid secure storage remove result");
  return null;
}
