const changeEvent = "velar-storage-change";
const storageMaxKeyCodeUnits = 4096;
const storageMaxListingCodeUnits = 16 * 1024 * 1024;
const storageMaxValueBytes = 16 * 1024 * 1024;
const storageNumberIsSafeInteger = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")?.value;
const storageStringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice").value;
const storageListSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort").value;
const storageMissingField = __velarBrowserMissingField;
const storageNativeUint8Array = typeof globalThis.Uint8Array === "function" ? globalThis.Uint8Array : null;
const storageTypedArrayPrototype = storageNativeUint8Array ? Object.getPrototypeOf(storageNativeUint8Array.prototype) : null;
const storageTypedArrayTag = storageTypedArrayPrototype ? Object.getOwnPropertyDescriptor(storageTypedArrayPrototype, Symbol.toStringTag)?.get : null;
const storageTypedArrayLength = storageTypedArrayPrototype ? Object.getOwnPropertyDescriptor(storageTypedArrayPrototype, "length")?.get : null;
const storageTypedArraySet = storageTypedArrayPrototype ? Object.getOwnPropertyDescriptor(storageTypedArrayPrototype, "set")?.value : null;
function storageBytesKind(value) {
  if (typeof storageTypedArrayTag !== "function") return null;
  try { return __velarBrowserReflectApply(storageTypedArrayTag, value, []); } catch { return null; }
}
const __velarStorageBytes = Object.freeze({
  is(value) { return storageBytesKind(value) === "Uint8Array"; },
  parse(value) {
    if (storageBytesKind(value) !== "Uint8Array" || typeof storageNativeUint8Array !== "function"
      || typeof storageTypedArrayLength !== "function" || typeof storageTypedArraySet !== "function") {
      throw new TypeError("Bytes requires Uint8Array");
    }
    const output = new storageNativeUint8Array(__velarBrowserReflectApply(storageTypedArrayLength, value, []));
    __velarBrowserReflectApply(storageTypedArraySet, output, [value]);
    return output;
  },
});

export class StorageQuotaError extends Error { constructor(message = "Browser storage quota was exceeded") { super(message); this.name = "StorageQuotaError"; } }
export class StorageTransactionError extends Error { constructor(message = "Browser storage transaction failed") { super(message); this.name = "StorageTransactionError"; } }
export class StorageUpgradeError extends Error { constructor(message = "Browser storage upgrade failed") { super(message); this.name = "StorageUpgradeError"; } }
function storageFailure(error, phase = "transaction") {
  if (error instanceof StorageQuotaError || error instanceof StorageTransactionError || error instanceof StorageUpgradeError) return error;
  if (error && typeof error === "object" && error.name === "QuotaExceededError") return new StorageQuotaError(error.message || undefined);
  const message = error && typeof error === "object" && typeof error.message === "string" ? error.message : undefined;
  return phase === "upgrade" ? new StorageUpgradeError(message) : new StorageTransactionError(message);
}

function storageType(Type) { return __velarRequireRuntimeType(Type, "Storage reads"); }
function storageText(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > storageMaxKeyCodeUnits) throw new RangeError(name + " cannot exceed 4096 characters"); return value; }
function storageSafeInteger(value) { return typeof storageNumberIsSafeInteger === "function" && __velarBrowserReflectApply(storageNumberIsSafeInteger, null, [value]); }
function storageByteBudget(value) { if (!storageSafeInteger(value) || value <= 0 || value > storageMaxValueBytes) throw new RangeError("Storage maxBytes must be an integer from 1 through 16777216"); return value; }
function storageOwnDataField(value, name) {
  return __velarBrowserOwnDataField(value, name);
}
function storageHostEventField(event, name, nativeGetter, constructor) {
  return storageHostField(event, name, nativeGetter, constructor);
}
function storageChangeSnapshot(event) {
  const detail = storageHostEventField(event, "detail", storageCustomEventDetail, storageNativeCustomEvent);
  if (detail === storageMissingField || detail === null || typeof detail !== "object") return null;
  const prototype = Object.getPrototypeOf(detail);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const areaName = storageOwnDataField(detail, "areaName");
  const key = storageOwnDataField(detail, "key");
  const newValue = storageOwnDataField(detail, "newValue");
  const oldValue = storageOwnDataField(detail, "oldValue");
  if (areaName === storageMissingField || key === storageMissingField || newValue === storageMissingField || oldValue === storageMissingField) return null;
  return { areaName, key, newValue, oldValue };
}
function storageEventSnapshot(event) {
  const storageArea = storageHostEventField(event, "storageArea", storageEventStorageArea, storageNativeStorageEvent);
  const key = storageHostEventField(event, "key", storageEventKey, storageNativeStorageEvent);
  const newValue = storageHostEventField(event, "newValue", storageEventNewValue, storageNativeStorageEvent);
  const oldValue = storageHostEventField(event, "oldValue", storageEventOldValue, storageNativeStorageEvent);
  if (storageArea === storageMissingField || key === storageMissingField || newValue === storageMissingField || oldValue === storageMissingField) return null;
  return { storageArea, key, newValue, oldValue };
}
function parsed(raw, Type, fallback, maxBytes) {
  Type = storageType(Type);
  if (raw == null) return fallback;
  if (typeof raw !== "string" || __velarUtf8ByteLength(raw) > maxBytes) return fallback;
  try { return __velarJsonParseTyped(Type, raw, "Stored JSON text"); } catch { return fallback; }
}

function createStore(storageArea, prefix = "", areaName = "local") {
  const area = () => {
    if (storageArea === storageMissingField || storageArea === null || (typeof storageArea !== "object" && typeof storageArea !== "function")) {
      throw new Error("velar/storage requires a browser storage environment");
    }
    return storageArea;
  };
  const full = (key) => {
    const value = storageText(key, "Storage key");
    if (prefix.length > storageMaxKeyCodeUnits - value.length) throw new RangeError("Scoped storage keys cannot exceed 4096 characters");
    return prefix + value;
  };
  const emit = (key, oldValue, newValue) => {
    if (typeof storageNativeCustomEvent !== "function") throw new TypeError("The browser CustomEvent API is unavailable");
    const detail = Object.freeze({ areaName, key, oldValue, newValue });
    return __velarBrowserCallCaptured(storageGlobalDispatch, storageWindow, [new storageNativeCustomEvent(changeEvent, { detail })], "dispatchEvent");
  };
  const api = {
    get(key, Type, fallback = null, maxBytes = storageMaxValueBytes) {
      Type = storageType(Type);
      maxBytes = storageByteBudget(maxBytes);
      const name = full(key);
      return parsed(storageHostCall(area(), "getItem", storageGetItem, storageNativeStorage, [name]), Type, fallback, maxBytes);
    },
    set(key, value, maxBytes = storageMaxValueBytes) {
      const name = full(key);
      maxBytes = storageByteBudget(maxBytes);
      const next = __velarJsonStringify(value);
      if (__velarUtf8ByteLength(next) > maxBytes) throw new RangeError("Stored JSON exceeds maxBytes");
      const target = area();
      const previous = storageHostCall(target, "getItem", storageGetItem, storageNativeStorage, [name]);
      storageHostCall(target, "setItem", storageSetItem, storageNativeStorage, [name, next]);
      emit(name, previous, next);
      return null;
    },
    has(key) { const name = full(key); return storageHostCall(area(), "getItem", storageGetItem, storageNativeStorage, [name]) != null; },
    keys() {
      const target = area();
      const count = storageHostField(target, "length", storageLength, storageNativeStorage);
      if (!storageSafeInteger(count) || count < 0 || count > 100000) throw new RangeError("Browser storage cannot exceed 100000 keys");
      const output = [];
      let outputUnits = 0;
      for (let index = 0; index < count; index += 1) {
        const key = storageHostCall(target, "key", storageKey, storageNativeStorage, [index]);
        if (key === null) continue;
        if (typeof key !== "string") throw new TypeError("Browser storage returned a non-string key");
        if (key.length < prefix.length || __velarBrowserCallCaptured(storageStringSlice, key, [0, prefix.length], "String.slice") !== prefix) continue;
        if (key.length > storageMaxKeyCodeUnits) throw new RangeError("Browser storage keys cannot exceed 4096 characters");
        const visible = __velarBrowserCallCaptured(storageStringSlice, key, [prefix.length], "String.slice");
        outputUnits += visible.length;
        if (outputUnits > storageMaxListingCodeUnits) throw new RangeError("Browser storage key listings cannot exceed 16 MiB");
        output.push(visible);
      }
      __velarBrowserCallCaptured(storageListSort, output, [], "Array.sort");
      return output;
    },
    remove(key) {
      const name = full(key);
      const target = area();
      const previous = storageHostCall(target, "getItem", storageGetItem, storageNativeStorage, [name]);
      storageHostCall(target, "removeItem", storageRemoveItem, storageNativeStorage, [name]);
      if (previous != null) emit(name, previous, null);
      return null;
    },
    clear() { for (const key of api.keys()) api.remove(key); return null; },
    scope(name) {
      const value = storageText(name, "Storage scope").trim();
      if (!value) throw new TypeError("Storage scope cannot be empty");
      if (prefix.length > storageMaxKeyCodeUnits - value.length - 1) throw new RangeError("Storage scope paths cannot exceed 4096 characters");
      return createStore(storageArea, prefix + value + ":", areaName);
    },
    watch(key, Type, callback, maxBytes = storageMaxValueBytes) {
      if (typeof callback !== "function") throw new TypeError("Storage watch requires a callback");
      Type = storageType(Type);
      maxBytes = storageByteBudget(maxBytes);
      const name = full(key);
      const changed = (event) => {
        const detail = storageChangeSnapshot(event);
        if (!detail || detail.areaName !== areaName || detail.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(detail.newValue, Type, null, maxBytes), parsed(detail.oldValue, Type, null, maxBytes)], "storage", "watch");
      };
      const stored = (event) => {
        const snapshot = storageEventSnapshot(event);
        if (!snapshot || snapshot.storageArea !== area() || snapshot.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(snapshot.newValue, Type, null, maxBytes), parsed(snapshot.oldValue, Type, null, maxBytes)], "storage", "watch");
      };
      const removeChanged = storageListenGlobal(changeEvent, changed);
      const removeStored = storageListenGlobal("storage", stored);
      return () => { removeChanged(); removeStored(); return null; };
    },
  };
  return Object.freeze(api);
}

export const storage = createStore(storageLocalArea);
export const session = createStore(storageSessionArea, "", "session");

export function database(name) {
  const databaseName = storageText(name, "Database name").trim();
  if (!databaseName) throw new TypeError("Database name cannot be empty");
  if (databaseName.length > 256) throw new RangeError("Database names cannot exceed 256 characters");
  if (storageIndexedDb === storageMissingField || storageIndexedDb === null) {
    throw new Error("velar/storage database requires IndexedDB");
  }
  let opened = null;
  const requestResult = (request) => storageHostField(request, "result", storageIdbRequestResult, storageNativeIdbRequest);
  const requestError = (request) => storageHostField(request, "error", storageIdbRequestError, storageNativeIdbRequest);
  const closeConnection = (value) => storageHostCall(value, "close", storageIdbClose, storageNativeIdbDatabase);
  const objectOperation = (store, operation, arguments_) => {
    const methods = {
      get: storageIdbObjectGet,
      put: storageIdbObjectPut,
      getKey: storageIdbObjectGetKey,
      getAllKeys: storageIdbObjectGetAllKeys,
      delete: storageIdbObjectDelete,
      clear: storageIdbObjectClear,
    };
    return storageHostCall(store, operation, methods[operation], storageNativeIdbObjectStore, arguments_);
  };
  const connect = () => {
    if (opened) return opened;
    const pending = new Promise((resolve, reject) => {
      let request;
      const guarded = (callback) => (...arguments_) => { try { callback(...arguments_); } catch (error) { reject(error); } };
      try {
        request = storageHostCall(storageIndexedDb, "open", storageIdbOpen, storageNativeIdbFactory, ["velar:" + databaseName, 1]);
        storageListen(request, "upgradeneeded", guarded(() => {
          const result = requestResult(request);
          const names = storageHostField(result, "objectStoreNames", storageIdbObjectStoreNames, storageNativeIdbDatabase);
          const present = storageHostCall(names, "contains", storageDomStringListContains, storageNativeDomStringList, ["values"]);
          if (typeof present !== "boolean") throw new TypeError("IndexedDB objectStoreNames.contains must return bool");
          if (!present) storageHostCall(result, "createObjectStore", storageIdbCreateObjectStore, storageNativeIdbDatabase, ["values"]);
        }), { once: true });
        storageListen(request, "success", guarded(() => {
          const result = requestResult(request);
          if (opened !== pending) { closeConnection(result); return; }
          storageListen(result, "versionchange", () => { closeConnection(result); if (opened === pending) opened = null; }, { once: true });
          storageListen(result, "close", () => { if (opened === pending) opened = null; }, { once: true });
          resolve(result);
        }), { once: true });
        storageListen(request, "error", guarded(() => reject(storageFailure(requestError(request), "upgrade"))), { once: true });
        storageListen(request, "blocked", () => reject(new StorageUpgradeError("VelarScript database upgrade is blocked by another open page")), { once: true });
      } catch (error) { reject(storageFailure(error, "upgrade")); }
    });
    opened = pending;
    void pending.catch(() => { if (opened === pending) opened = null; });
    return pending;
  };
  const request = async (mode, operation) => {
    const connection = connect();
    const db = await connection;
    return new Promise((resolve, reject) => {
      let transaction;
      try { transaction = storageHostCall(db, "transaction", storageIdbTransaction, storageNativeIdbDatabase, ["values", mode]); }
      catch (error) {
        if (opened === connection) {
          opened = null;
          try { closeConnection(db); } catch {}
        }
        reject(storageFailure(error));
        return;
      }
      let value;
      let settled = false;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      const guarded = (callback) => (...arguments_) => { try { callback(...arguments_); } catch (error) { fail(error); } };
      try {
        const store = storageHostCall(transaction, "objectStore", storageIdbTransactionObjectStore, storageNativeIdbTransaction, ["values"]);
        const result = operation(store);
        if (result !== null) {
          storageListen(result, "success", guarded(() => { value = requestResult(result); }), { once: true });
          storageListen(result, "error", guarded(() => fail(storageFailure(requestError(result)))), { once: true });
        }
        storageListen(transaction, "abort", guarded(() => fail(storageFailure(storageHostField(transaction, "error", storageIdbTransactionError, storageNativeIdbTransaction)))), { once: true });
        storageListen(transaction, "error", guarded(() => fail(storageFailure(storageHostField(transaction, "error", storageIdbTransactionError, storageNativeIdbTransaction)))), { once: true });
        storageListen(transaction, "complete", guarded(() => { if (!settled) { settled = true; resolve(value); } }), { once: true });
      } catch (error) {
        try { storageHostCall(transaction, "abort", storageIdbTransactionAbort, storageNativeIdbTransaction); } catch {}
        fail(storageFailure(error));
      }
    });
  };
  const keyOf = (key) => storageText(key, "Database key");
  return Object.freeze({
    async get(key, Type, fallback = null, maxBytes = storageMaxValueBytes) { Type = storageType(Type); maxBytes = storageByteBudget(maxBytes); const name = keyOf(key); const encoded = await request("readonly", (store) => objectOperation(store, "get", [name])); if (encoded === undefined || typeof encoded !== "string" || __velarUtf8ByteLength(encoded) > maxBytes) return fallback; try { return __velarJsonParseTyped(Type, encoded, "Stored JSON text"); } catch { return fallback; } },
    async set(key, value, maxBytes = storageMaxValueBytes) {
      const name = keyOf(key);
      maxBytes = storageByteBudget(maxBytes);
      const encoded = __velarJsonStringify(value);
      if (__velarUtf8ByteLength(encoded) > maxBytes) throw new RangeError("Stored JSON exceeds maxBytes");
      await request("readwrite", (store) => objectOperation(store, "put", [encoded, name]));
      return null;
    },
    async getBytes(key, fallback = null, maxBytes = storageMaxValueBytes) {
      const name = keyOf(key);
      maxBytes = storageByteBudget(maxBytes);
      const value = await request("readonly", (store) => objectOperation(store, "get", [name]));
      if (value === undefined) return fallback === null ? null : __velarStorageBytes.parse(fallback);
      let bytes;
      try { bytes = __velarStorageBytes.parse(value); } catch { throw new StorageTransactionError("Stored value is not Bytes"); }
      if (bytes.byteLength > maxBytes) throw new StorageTransactionError("Stored Bytes exceeds maxBytes");
      return bytes;
    },
    async setBytes(key, value, maxBytes = storageMaxValueBytes) {
      const name = keyOf(key);
      maxBytes = storageByteBudget(maxBytes);
      const bytes = __velarStorageBytes.parse(value);
      if (bytes.byteLength > maxBytes) throw new RangeError("Stored Bytes exceeds maxBytes");
      await request("readwrite", (store) => objectOperation(store, "put", [bytes, name]));
      return null;
    },
    async batch(changes) {
      changes = __velarRequireList(changes, "Database batch changes");
      if (changes.length > 10000) throw new RangeError("Database batches cannot exceed 10000 changes");
      const checked = [];
      let totalBytes = 0;
      for (let index = 0; index < changes.length; index += 1) {
        const change = changes[index];
        if (!change || typeof change !== "object" || Array.isArray(change)) throw new TypeError("Database batch changes must be records");
        const keys = Object.keys(change);
        if (keys.length !== 2 || !keys.includes("key") || !keys.includes("bytes")) throw new TypeError("Database batch changes require exactly key and bytes");
        const key = keyOf(change.key);
        const bytes = change.bytes === null ? null : __velarStorageBytes.parse(change.bytes);
        totalBytes += bytes?.byteLength ?? 0;
        if (totalBytes > 64 * 1024 * 1024) throw new RangeError("Database batch Bytes cannot exceed 64 MiB");
        checked.push({key, bytes});
      }
      await request("readwrite", (store) => {
        for (const change of checked) {
          objectOperation(store, change.bytes === null ? "delete" : "put", change.bytes === null ? [change.key] : [change.bytes, change.key]);
        }
        return null;
      });
      return null;
    },
    async has(key) { const name = keyOf(key); return (await request("readonly", (store) => objectOperation(store, "getKey", [name]))) !== undefined; },
    async keys() {
      let keys = await request("readonly", (store) => objectOperation(store, "getAllKeys", [undefined, 100001]));
      if (!Array.isArray(keys)) throw new TypeError("VelarScript database keys must be a List");
      if (keys.length > 100000) throw new RangeError("VelarScript databases cannot expose more than 100000 keys at once");
      keys = __velarRequireList(keys, "Database keys");
      for (const key of keys) if (typeof key !== "string") throw new TypeError("VelarScript database contains a non-string key");
      __velarBrowserCallCaptured(storageListSort, keys, [], "Array.sort");
      return keys;
    },
    async remove(key) { const name = keyOf(key); await request("readwrite", (store) => objectOperation(store, "delete", [name])); return null; },
    async clear() { await request("readwrite", (store) => objectOperation(store, "clear", [])); return null; },
  });
}
