const storageWindow = globalThis;
const storageLocalArea = __velarBrowserGlobalField("localStorage");
const storageSessionArea = __velarBrowserGlobalField("sessionStorage");
const storageIndexedDb = __velarBrowserGlobalField("indexedDB");
const storageNativeStorage = __velarBrowserConstructor("Storage");
const storageNativeCustomEvent = __velarBrowserConstructor("CustomEvent");
const storageNativeStorageEvent = __velarBrowserConstructor("StorageEvent");
const storageNativeEventTarget = __velarBrowserConstructor("EventTarget");
const storageNativeIdbFactory = __velarBrowserConstructor("IDBFactory");
const storageNativeIdbRequest = __velarBrowserConstructor("IDBRequest");
const storageNativeIdbDatabase = __velarBrowserConstructor("IDBDatabase");
const storageNativeIdbTransaction = __velarBrowserConstructor("IDBTransaction");
const storageNativeIdbObjectStore = __velarBrowserConstructor("IDBObjectStore");
const storageNativeDomStringList = __velarBrowserConstructor("DOMStringList");
const storageLength = __velarBrowserPrototypeMember(storageNativeStorage, "length", "get");
const storageKey = __velarBrowserPrototypeMember(storageNativeStorage, "key", "value");
const storageGetItem = __velarBrowserPrototypeMember(storageNativeStorage, "getItem", "value");
const storageSetItem = __velarBrowserPrototypeMember(storageNativeStorage, "setItem", "value");
const storageRemoveItem = __velarBrowserPrototypeMember(storageNativeStorage, "removeItem", "value");
const storageCustomEventDetail = __velarBrowserPrototypeMember(storageNativeCustomEvent, "detail", "get");
const storageEventStorageArea = __velarBrowserPrototypeMember(storageNativeStorageEvent, "storageArea", "get");
const storageEventKey = __velarBrowserPrototypeMember(storageNativeStorageEvent, "key", "get");
const storageEventNewValue = __velarBrowserPrototypeMember(storageNativeStorageEvent, "newValue", "get");
const storageEventOldValue = __velarBrowserPrototypeMember(storageNativeStorageEvent, "oldValue", "get");
const storageEventAdd = __velarBrowserPrototypeMember(storageNativeEventTarget, "addEventListener", "value");
const storageEventRemove = __velarBrowserPrototypeMember(storageNativeEventTarget, "removeEventListener", "value");
const storageGlobalAdd = __velarBrowserGlobalMember("addEventListener", "value");
const storageGlobalRemove = __velarBrowserGlobalMember("removeEventListener", "value");
const storageGlobalDispatch = __velarBrowserGlobalMember("dispatchEvent", "value");
const storageIdbOpen = __velarBrowserPrototypeMember(storageNativeIdbFactory, "open", "value");
const storageIdbRequestResult = __velarBrowserPrototypeMember(storageNativeIdbRequest, "result", "get");
const storageIdbRequestError = __velarBrowserPrototypeMember(storageNativeIdbRequest, "error", "get");
const storageIdbObjectStoreNames = __velarBrowserPrototypeMember(storageNativeIdbDatabase, "objectStoreNames", "get");
const storageIdbTransaction = __velarBrowserPrototypeMember(storageNativeIdbDatabase, "transaction", "value");
const storageIdbCreateObjectStore = __velarBrowserPrototypeMember(storageNativeIdbDatabase, "createObjectStore", "value");
const storageIdbClose = __velarBrowserPrototypeMember(storageNativeIdbDatabase, "close", "value");
const storageDomStringListContains = __velarBrowserPrototypeMember(storageNativeDomStringList, "contains", "value");
const storageIdbTransactionObjectStore = __velarBrowserPrototypeMember(storageNativeIdbTransaction, "objectStore", "value");
const storageIdbTransactionError = __velarBrowserPrototypeMember(storageNativeIdbTransaction, "error", "get");
const storageIdbTransactionAbort = __velarBrowserPrototypeMember(storageNativeIdbTransaction, "abort", "value");
const storageIdbObjectGet = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "get", "value");
const storageIdbObjectPut = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "put", "value");
const storageIdbObjectGetKey = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "getKey", "value");
const storageIdbObjectGetAllKeys = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "getAllKeys", "value");
const storageIdbObjectDelete = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "delete", "value");
const storageIdbObjectClear = __velarBrowserPrototypeMember(storageNativeIdbObjectStore, "clear", "value");
function storageHostField(value, name, nativeGetter, constructor) {
  return __velarBrowserField(value, name, nativeGetter, constructor);
}
function storageHostCall(value, name, nativeMethod, constructor, arguments_ = []) {
  return __velarBrowserCall(value, name, nativeMethod, constructor, arguments_);
}
function storageListen(target, name, callback, options = undefined) {
  if (__velarBrowserNativeInstance(target, storageNativeEventTarget)) {
    __velarBrowserCallCaptured(storageEventAdd, target, [name, callback, options], "EventTarget.addEventListener");
    return () => __velarBrowserCallCaptured(storageEventRemove, target, [name, callback, options?.capture ?? false], "EventTarget.removeEventListener");
  }
  const add = __velarBrowserDataMethod(target, "addEventListener");
  const remove = __velarBrowserDataMethod(target, "removeEventListener");
  __velarBrowserCallCaptured(add, target, [name, callback, options], "addEventListener");
  return () => __velarBrowserCallCaptured(remove, target, [name, callback, options?.capture ?? false], "removeEventListener");
}
function storageListenGlobal(name, callback) {
  __velarBrowserCallCaptured(storageGlobalAdd, storageWindow, [name, callback], "global addEventListener");
  return () => __velarBrowserCallCaptured(storageGlobalRemove, storageWindow, [name, callback], "global removeEventListener");
}
