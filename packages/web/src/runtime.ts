import {
  VELAR_ERROR_NORMALIZATION_RUNTIME,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TEXT_METHOD_RUNTIME,
  VELAR_TYPE_REGISTRY_RUNTIME,
  VELAR_UTF8_RUNTIME,
} from "@velarscript/compiler/extension";
import { WEB_DOM_HOST_RUNTIME, WEB_ERROR_HOST_RUNTIME, WEB_RUNTIME_FOUNDATION } from "./runtime-foundation.ts";

const ownedCallbackRuntime = String.raw`
${WEB_ERROR_HOST_RUNTIME}
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
  const runtime = globalThis[Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})];
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
`.trimStart();

const fileRegistryRuntime = String.raw`
const nativeFilesKey = Symbol.for("velar.file.registry.v1");
const nativeFiles = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, nativeFilesKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("VelarScript file registry cannot be an accessor");
    if (descriptor.configurable || descriptor.enumerable || descriptor.writable) throw new TypeError("VelarScript file registry ownership is invalid");
    try { WeakMap.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("VelarScript file registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakMap();
  Object.defineProperty(globalThis, nativeFilesKey, { value: registry, enumerable: false, configurable: false, writable: false });
  return registry;
})();
const __velarNativeFileName = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "name")?.get : null;
const __velarNativeFileModified = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "lastModified")?.get : null;
const __velarNativeBlobSize = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get : null;
const __velarNativeBlobType = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "type")?.get : null;
const __velarNativeBlobText = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "text")?.value : null;
function __velarReadNativeFileField(operation, file) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native File API");
  try { return operation.call(file); }
  catch { throw new TypeError("A file picker returned an invalid native File"); }
}
function __velarNativeFile(value, message) {
  const file = value && WeakMap.prototype.get.call(nativeFiles, value);
  if (!file) throw new TypeError(message);
  try {
    if (typeof __velarNativeFileName !== "function") throw new TypeError();
    __velarNativeFileName.call(file);
  } catch { throw new TypeError(message); }
  return file;
}
`.trimStart();

const listRuntime = String.raw`
const __velarMaxListItems = 1000000;
const __velarListNativeArray = globalThis.Array;
const __velarListNativeObject = globalThis.Object;
const __velarListNativeSymbol = globalThis.Symbol;
const __velarListReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarListArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarListGetOwnPropertySymbols = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarListGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarListGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarListDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const __velarListSymbolFor = Object.getOwnPropertyDescriptor(Symbol, "for")?.value;
const __velarListRuntimeKey = typeof __velarListReflectApply === "function" && typeof __velarListSymbolFor === "function"
  ? __velarListReflectApply(__velarListSymbolFor, __velarListNativeSymbol, [${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}]) : null;
const __velarListIterateKey = typeof __velarListReflectApply === "function" && typeof __velarListSymbolFor === "function"
  ? __velarListReflectApply(__velarListSymbolFor, __velarListNativeSymbol, ["velar.reactive.iterate.v1"]) : null;
function __velarRequireListIntrinsics() {
  if (typeof __velarListNativeArray !== "function" || typeof __velarListNativeObject !== "function"
    || typeof __velarListReflectApply !== "function" || typeof __velarListArrayIsArray !== "function"
    || typeof __velarListGetOwnPropertySymbols !== "function" || typeof __velarListGetOwnPropertyNames !== "function"
    || typeof __velarListGetOwnPropertyDescriptor !== "function" || typeof __velarListDefineProperty !== "function"
    || __velarListRuntimeKey === null || __velarListIterateKey === null) {
    throw new TypeError("The Web List guard intrinsics are unavailable");
  }
}
function __velarListReactiveRuntime() {
  __velarRequireListIntrinsics();
  const descriptor = __velarListReflectApply(__velarListGetOwnPropertyDescriptor, __velarListNativeObject, [globalThis, __velarListRuntimeKey]);
  const runtime = descriptor && "value" in descriptor ? descriptor.value : null;
  return runtime && runtime.version === ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)} && typeof runtime.toRaw === "function"
    && typeof runtime.collectionRead === "function" ? runtime : null;
}
function __velarRequireList(value, name) {
  __velarRequireListIntrinsics();
  const reactive = __velarListReactiveRuntime();
  if (reactive) value = reactive.toRaw(value);
  if (!__velarListReflectApply(__velarListArrayIsArray, __velarListNativeArray, [value])) throw new TypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new RangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (__velarListReflectApply(__velarListGetOwnPropertySymbols, __velarListNativeObject, [value]).length > 0
    || __velarListReflectApply(__velarListGetOwnPropertyNames, __velarListNativeObject, [value]).length !== value.length + 1) {
    throw new TypeError(name + " requires a dense List without extra fields");
  }
  const lengthDescriptor = __velarListReflectApply(__velarListGetOwnPropertyDescriptor, __velarListNativeObject, [value, "length"]);
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new TypeError(name + " requires an ordinary mutable List length");
  }
  const output = new __velarListNativeArray(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarListReflectApply(__velarListGetOwnPropertyDescriptor, __velarListNativeObject, [value, index]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new TypeError(name + " requires ordinary mutable List elements");
    }
    const item = reactive ? reactive.collectionRead(value, __velarListIterateKey, descriptor.value) : descriptor.value;
    __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [output, index, {
      value: item, enumerable: true, configurable: true, writable: true,
    }]);
  }
  return output;
}
`.trimStart();

const optionsRuntime = String.raw`
const __velarOptionsNativeArray = globalThis.Array;
const __velarOptionsNativeObject = globalThis.Object;
const __velarOptionsNativeSet = globalThis.Set;
const __velarOptionsReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarOptionsArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarOptionsGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarOptionsGetOwnPropertySymbols = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarOptionsGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarOptionsGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarOptionsCreate = Object.getOwnPropertyDescriptor(Object, "create")?.value;
const __velarOptionsFreeze = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarOptionsSetHas = Object.getOwnPropertyDescriptor(Set.prototype, "has")?.value;
const __velarOptionsSetAdd = Object.getOwnPropertyDescriptor(Set.prototype, "add")?.value;
const __velarOptionsObjectPrototype = Object.prototype;
function __velarRequireOptionsIntrinsics() {
  if (typeof __velarOptionsNativeArray !== "function" || typeof __velarOptionsNativeObject !== "function"
    || typeof __velarOptionsNativeSet !== "function" || typeof __velarOptionsReflectApply !== "function"
    || typeof __velarOptionsArrayIsArray !== "function" || typeof __velarOptionsGetPrototypeOf !== "function"
    || typeof __velarOptionsGetOwnPropertySymbols !== "function" || typeof __velarOptionsGetOwnPropertyNames !== "function"
    || typeof __velarOptionsGetOwnPropertyDescriptor !== "function" || typeof __velarOptionsCreate !== "function"
    || typeof __velarOptionsFreeze !== "function" || typeof __velarOptionsSetHas !== "function"
    || typeof __velarOptionsSetAdd !== "function") {
    throw new TypeError("The Web options guard intrinsics are unavailable");
  }
}
function __velarOptionFields(fields) {
  __velarRequireOptionsIntrinsics();
  if (!__velarOptionsReflectApply(__velarOptionsArrayIsArray, __velarOptionsNativeArray, [fields])) {
    throw new TypeError("Web option fields must be an internal List");
  }
  const allowed = new __velarOptionsNativeSet();
  for (let index = 0; index < fields.length; index += 1) {
    if (typeof fields[index] !== "string") throw new TypeError("Web option fields must be text");
    __velarOptionsReflectApply(__velarOptionsSetAdd, allowed, [fields[index]]);
  }
  return allowed;
}
function __velarFreezeOptionsValue(value) {
  __velarRequireOptionsIntrinsics();
  return __velarOptionsReflectApply(__velarOptionsFreeze, __velarOptionsNativeObject, [value]);
}
function __velarOptions(value, name, allowed) {
  __velarRequireOptionsIntrinsics();
  let prototype = null;
  if (value && typeof value === "object") {
    prototype = __velarOptionsReflectApply(__velarOptionsGetPrototypeOf, __velarOptionsNativeObject, [value]);
  }
  if (!value || typeof value !== "object"
    || __velarOptionsReflectApply(__velarOptionsArrayIsArray, __velarOptionsNativeArray, [value])
    || (prototype !== __velarOptionsObjectPrototype && prototype !== null)) {
    throw new TypeError(name + " must be a record");
  }
  if (__velarOptionsReflectApply(__velarOptionsGetOwnPropertySymbols, __velarOptionsNativeObject, [value]).length > 0) {
    throw new TypeError(name + " cannot contain symbol fields");
  }
  const output = __velarOptionsReflectApply(__velarOptionsCreate, __velarOptionsNativeObject, [null]);
  const keys = __velarOptionsReflectApply(__velarOptionsGetOwnPropertyNames, __velarOptionsNativeObject, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!__velarOptionsReflectApply(__velarOptionsSetHas, allowed, [key])) throw new TypeError("Unknown " + name + " field '" + key + "'");
    const descriptor = __velarOptionsReflectApply(__velarOptionsGetOwnPropertyDescriptor, __velarOptionsNativeObject, [value, key]);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " field '" + key + "' must be an enumerable data value");
    output[key] = descriptor.value;
  }
  return __velarFreezeOptionsValue(output);
}
function __velarString(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); return value; }
function __velarBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
`.trimStart();

const webHostAbiRuntime = String.raw`
const __velarBrowserMissingField = Object.freeze({});
const __velarBrowserReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarBrowserGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarBrowserGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarBrowserHasInstance = Object.getOwnPropertyDescriptor(Function.prototype, Symbol.hasInstance)?.value;
function __velarBrowserDescriptor(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof __velarBrowserGetOwnPropertyDescriptor !== "function" || typeof __velarBrowserGetPrototypeOf !== "function") return null;
  let current = value;
  while (current !== null) {
    const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [current, name]);
    if (descriptor) return descriptor;
    current = __velarBrowserReflectApply(__velarBrowserGetPrototypeOf, Object, [current]);
  }
  return null;
}
function __velarBrowserOwnDataField(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof __velarBrowserGetOwnPropertyDescriptor !== "function") return __velarBrowserMissingField;
  const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [value, name]);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : __velarBrowserMissingField;
}
function __velarBrowserDataMethod(value, name) {
  const descriptor = __velarBrowserDescriptor(value, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "function"
    ? descriptor.value
    : __velarBrowserMissingField;
}
function __velarBrowserGlobalMember(name, kind) {
  const descriptor = __velarBrowserDescriptor(globalThis, name);
  if (!descriptor) return null;
  const member = kind === "get" ? descriptor.get : "value" in descriptor ? descriptor.value : null;
  return typeof member === "function" ? member : null;
}
function __velarBrowserGlobalField(name) {
  const descriptor = __velarBrowserDescriptor(globalThis, name);
  if (!descriptor) return __velarBrowserMissingField;
  if ("value" in descriptor) return descriptor.value;
  if (typeof descriptor.get !== "function" || typeof __velarBrowserReflectApply !== "function") return __velarBrowserMissingField;
  try { return __velarBrowserReflectApply(descriptor.get, globalThis, []); }
  catch { return __velarBrowserMissingField; }
}
function __velarBrowserConstructor(name) {
  const value = __velarBrowserGlobalField(name);
  return typeof value === "function" ? value : null;
}
function __velarBrowserPrototypeMember(constructor, name, kind) {
  if (typeof constructor !== "function" || typeof __velarBrowserGetOwnPropertyDescriptor !== "function") return null;
  const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [constructor, "prototype"]);
  const member = descriptor && "value" in descriptor ? __velarBrowserDescriptor(descriptor.value, name) : null;
  if (!member) return null;
  const operation = kind === "get" ? member.get : "value" in member ? member.value : null;
  return typeof operation === "function" ? operation : null;
}
function __velarBrowserHostMember(value, constructor, name, kind) {
  const descriptor = __velarBrowserDescriptor(value, name);
  if (descriptor) {
    const operation = kind === "get" ? descriptor.get : "value" in descriptor ? descriptor.value : null;
    if (typeof operation === "function") return operation;
  }
  return __velarBrowserPrototypeMember(constructor, name, kind);
}
function __velarBrowserNativeInstance(value, constructor) {
  if (typeof constructor !== "function" || typeof __velarBrowserHasInstance !== "function"
    || typeof __velarBrowserReflectApply !== "function") return false;
  try { return __velarBrowserReflectApply(__velarBrowserHasInstance, constructor, [value]) === true; }
  catch { return false; }
}
function __velarBrowserField(value, name, nativeGetter, constructor) {
  if (typeof nativeGetter === "function" && __velarBrowserNativeInstance(value, constructor)) {
    return __velarBrowserReflectApply(nativeGetter, value, []);
  }
  return __velarBrowserOwnDataField(value, name);
}
function __velarBrowserCallCaptured(operation, receiver, arguments_, name) {
  if (typeof operation !== "function" || typeof __velarBrowserReflectApply !== "function") {
    throw new TypeError("The browser does not expose native " + name);
  }
  return __velarBrowserReflectApply(operation, receiver, arguments_);
}
function __velarBrowserCall(value, name, nativeMethod, constructor, arguments_ = []) {
  if (typeof nativeMethod === "function" && __velarBrowserNativeInstance(value, constructor)) {
    return __velarBrowserReflectApply(nativeMethod, value, arguments_);
  }
  const method = __velarBrowserOwnDataField(value, name);
  if (typeof method !== "function") throw new TypeError("The browser returned an invalid " + name + " host operation");
  return __velarBrowserCallCaptured(method, value, arguments_, name);
}
`.trimStart();

const browserHostRuntime = String.raw`
${webHostAbiRuntime}
const __velarBrowserWindow = globalThis;
const __velarBrowserLocation = __velarBrowserGlobalField("location");
const __velarBrowserNavigator = __velarBrowserGlobalField("navigator");
const __velarBrowserDocument = __velarBrowserGlobalField("document");
const __velarBrowserHistory = __velarBrowserGlobalField("history");
const __velarBrowserSecureContext = __velarBrowserGlobalField("isSecureContext");
const __velarBrowserLocationConstructor = __velarBrowserConstructor("Location");
const __velarBrowserNavigatorConstructor = __velarBrowserConstructor("Navigator");
const __velarBrowserDocumentConstructor = __velarBrowserConstructor("Document");
const __velarBrowserMediaQueryListConstructor = __velarBrowserConstructor("MediaQueryList");
const __velarBrowserEventTargetConstructor = __velarBrowserConstructor("EventTarget");
const __velarBrowserNodeConstructor = __velarBrowserConstructor("Node");
const __velarBrowserElementConstructor = __velarBrowserConstructor("Element");
const __velarBrowserHtmlElementConstructor = __velarBrowserConstructor("HTMLElement");
const __velarBrowserTextAreaConstructor = __velarBrowserConstructor("HTMLTextAreaElement");
const __velarBrowserDialogConstructor = __velarBrowserConstructor("HTMLDialogElement");
const __velarBrowserClipboardEventConstructor = __velarBrowserConstructor("ClipboardEvent");
const __velarBrowserDataTransferConstructor = __velarBrowserConstructor("DataTransfer");
const __velarBrowserDomRectConstructor = __velarBrowserConstructor("DOMRect");
const __velarBrowserDomRectReadOnlyConstructor = __velarBrowserConstructor("DOMRectReadOnly");
const __velarBrowserClipboardConstructor = __velarBrowserConstructor("Clipboard");
const __velarBrowserHistoryConstructor = __velarBrowserConstructor("History");
const __velarBrowserUrlConstructor = __velarBrowserConstructor("URL");
const __velarBrowserUrlSearchParamsConstructor = __velarBrowserConstructor("URLSearchParams");
const __velarBrowserPopStateEventConstructor = __velarBrowserConstructor("PopStateEvent");
const __velarBrowserLocationHref = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "href", "get");
const __velarBrowserLocationOrigin = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "origin", "get");
const __velarBrowserLocationPathname = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "pathname", "get");
const __velarBrowserLocationSearch = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "search", "get");
const __velarBrowserLocationHash = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "hash", "get");
const __velarBrowserLocationReload = __velarBrowserHostMember(__velarBrowserLocation, __velarBrowserLocationConstructor, "reload", "value");
const __velarBrowserNavigatorLanguage = __velarBrowserPrototypeMember(__velarBrowserNavigatorConstructor, "language", "get");
const __velarBrowserNavigatorLanguages = __velarBrowserPrototypeMember(__velarBrowserNavigatorConstructor, "languages", "get");
const __velarBrowserNavigatorOnline = __velarBrowserPrototypeMember(__velarBrowserNavigatorConstructor, "onLine", "get");
const __velarBrowserNavigatorTouchPoints = __velarBrowserPrototypeMember(__velarBrowserNavigatorConstructor, "maxTouchPoints", "get");
const __velarBrowserNavigatorClipboard = __velarBrowserPrototypeMember(__velarBrowserNavigatorConstructor, "clipboard", "get");
const __velarBrowserDocumentVisibility = __velarBrowserPrototypeMember(__velarBrowserDocumentConstructor, "visibilityState", "get");
const __velarBrowserMediaMatches = __velarBrowserPrototypeMember(__velarBrowserMediaQueryListConstructor, "matches", "get");
const __velarBrowserNodeConnected = __velarBrowserPrototypeMember(__velarBrowserNodeConstructor, "isConnected", "get");
const __velarBrowserDialogOpen = __velarBrowserPrototypeMember(__velarBrowserDialogConstructor, "open", "get");
const __velarBrowserDialogResult = __velarBrowserPrototypeMember(__velarBrowserDialogConstructor, "returnValue", "get");
const __velarBrowserDialogShowModal = __velarBrowserPrototypeMember(__velarBrowserDialogConstructor, "showModal", "value");
const __velarBrowserDialogClose = __velarBrowserPrototypeMember(__velarBrowserDialogConstructor, "close", "value");
const __velarBrowserElementScrollIntoView = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollIntoView", "value");
const __velarBrowserElementScrollTo = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollTo", "value");
const __velarBrowserElementScrollLeft = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollLeft", "get");
const __velarBrowserElementScrollTop = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollTop", "get");
const __velarBrowserElementScrollWidth = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollWidth", "get");
const __velarBrowserElementScrollHeight = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "scrollHeight", "get");
const __velarBrowserElementClientWidth = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "clientWidth", "get");
const __velarBrowserElementClientHeight = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "clientHeight", "get");
const __velarBrowserElementSetPointerCapture = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "setPointerCapture", "value");
const __velarBrowserElementReleasePointerCapture = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "releasePointerCapture", "value");
const __velarBrowserElementMeasure = __velarBrowserPrototypeMember(__velarBrowserElementConstructor, "getBoundingClientRect", "value");
const __velarBrowserElementFocus = __velarBrowserPrototypeMember(__velarBrowserHtmlElementConstructor, "focus", "value");
const __velarBrowserElementBlur = __velarBrowserPrototypeMember(__velarBrowserHtmlElementConstructor, "blur", "value");
const __velarBrowserTextAreaValue = __velarBrowserPrototypeMember(__velarBrowserTextAreaConstructor, "value", "get");
const __velarBrowserTextAreaSelectionStart = __velarBrowserPrototypeMember(__velarBrowserTextAreaConstructor, "selectionStart", "get");
const __velarBrowserTextAreaSelectionEnd = __velarBrowserPrototypeMember(__velarBrowserTextAreaConstructor, "selectionEnd", "get");
const __velarBrowserTextAreaSelectionDirection = __velarBrowserPrototypeMember(__velarBrowserTextAreaConstructor, "selectionDirection", "get");
const __velarBrowserTextAreaSetSelectionRange = __velarBrowserPrototypeMember(__velarBrowserTextAreaConstructor, "setSelectionRange", "value");
const __velarBrowserRectX = __velarBrowserPrototypeMember(__velarBrowserDomRectConstructor, "x", "get");
const __velarBrowserRectY = __velarBrowserPrototypeMember(__velarBrowserDomRectConstructor, "y", "get");
const __velarBrowserRectWidth = __velarBrowserPrototypeMember(__velarBrowserDomRectConstructor, "width", "get");
const __velarBrowserRectHeight = __velarBrowserPrototypeMember(__velarBrowserDomRectConstructor, "height", "get");
const __velarBrowserRectTop = __velarBrowserPrototypeMember(__velarBrowserDomRectReadOnlyConstructor, "top", "get");
const __velarBrowserRectRight = __velarBrowserPrototypeMember(__velarBrowserDomRectReadOnlyConstructor, "right", "get");
const __velarBrowserRectBottom = __velarBrowserPrototypeMember(__velarBrowserDomRectReadOnlyConstructor, "bottom", "get");
const __velarBrowserRectLeft = __velarBrowserPrototypeMember(__velarBrowserDomRectReadOnlyConstructor, "left", "get");
const __velarBrowserClipboardWrite = __velarBrowserPrototypeMember(__velarBrowserClipboardConstructor, "writeText", "value");
const __velarBrowserClipboardRead = __velarBrowserPrototypeMember(__velarBrowserClipboardConstructor, "readText", "value");
const __velarBrowserClipboardEventData = __velarBrowserPrototypeMember(__velarBrowserClipboardEventConstructor, "clipboardData", "get");
const __velarBrowserDataTransferGetData = __velarBrowserPrototypeMember(__velarBrowserDataTransferConstructor, "getData", "value");
const __velarBrowserDataTransferSetData = __velarBrowserPrototypeMember(__velarBrowserDataTransferConstructor, "setData", "value");
const __velarBrowserEventAdd = __velarBrowserPrototypeMember(__velarBrowserEventTargetConstructor, "addEventListener", "value");
const __velarBrowserEventRemove = __velarBrowserPrototypeMember(__velarBrowserEventTargetConstructor, "removeEventListener", "value");
const __velarBrowserEventDispatch = __velarBrowserPrototypeMember(__velarBrowserEventTargetConstructor, "dispatchEvent", "value");
const __velarBrowserHistoryPush = __velarBrowserPrototypeMember(__velarBrowserHistoryConstructor, "pushState", "value");
const __velarBrowserHistoryReplace = __velarBrowserPrototypeMember(__velarBrowserHistoryConstructor, "replaceState", "value");
const __velarBrowserHistoryBack = __velarBrowserPrototypeMember(__velarBrowserHistoryConstructor, "back", "value");
const __velarBrowserHistoryForward = __velarBrowserPrototypeMember(__velarBrowserHistoryConstructor, "forward", "value");
const __velarBrowserUrlOrigin = __velarBrowserPrototypeMember(__velarBrowserUrlConstructor, "origin", "get");
const __velarBrowserUrlPathname = __velarBrowserPrototypeMember(__velarBrowserUrlConstructor, "pathname", "get");
const __velarBrowserUrlSearch = __velarBrowserPrototypeMember(__velarBrowserUrlConstructor, "search", "get");
const __velarBrowserUrlHash = __velarBrowserPrototypeMember(__velarBrowserUrlConstructor, "hash", "get");
const __velarBrowserUrlSearchParamsForEach = __velarBrowserPrototypeMember(__velarBrowserUrlSearchParamsConstructor, "forEach", "value");
const __velarBrowserSetTimeout = __velarBrowserGlobalMember("setTimeout", "value");
const __velarBrowserClearTimeout = __velarBrowserGlobalMember("clearTimeout", "value");
const __velarBrowserQueueMicrotask = __velarBrowserGlobalMember("queueMicrotask", "value");
const __velarBrowserMatchMedia = __velarBrowserGlobalMember("matchMedia", "value");
const __velarBrowserOpen = __velarBrowserGlobalMember("open", "value");
const __velarBrowserScrollTo = __velarBrowserGlobalMember("scrollTo", "value");
const __velarBrowserAnimationFrame = __velarBrowserGlobalMember("requestAnimationFrame", "value");
const __velarBrowserGlobalAddEventListener = __velarBrowserGlobalMember("addEventListener", "value");
const __velarBrowserGlobalRemoveEventListener = __velarBrowserGlobalMember("removeEventListener", "value");
const __velarBrowserGlobalDispatchEvent = __velarBrowserGlobalMember("dispatchEvent", "value");
const __velarBrowserClipboard = __velarBrowserField(__velarBrowserNavigator, "clipboard", __velarBrowserNavigatorClipboard, __velarBrowserNavigatorConstructor);
function __velarBrowserListen(target, name, callback, options = undefined) {
  if (__velarBrowserNativeInstance(target, __velarBrowserEventTargetConstructor)) {
    __velarBrowserCallCaptured(__velarBrowserEventAdd, target, [name, callback, options], "EventTarget.addEventListener");
    return () => __velarBrowserCallCaptured(__velarBrowserEventRemove, target, [name, callback, options?.capture ?? false], "EventTarget.removeEventListener");
  }
  const add = __velarBrowserDataMethod(target, "addEventListener");
  const remove = __velarBrowserDataMethod(target, "removeEventListener");
  __velarBrowserCallCaptured(add, target, [name, callback, options], "addEventListener");
  return () => __velarBrowserCallCaptured(remove, target, [name, callback, options?.capture ?? false], "removeEventListener");
}
function __velarBrowserListenGlobal(name, callback, options = undefined) {
  __velarBrowserCallCaptured(__velarBrowserGlobalAddEventListener, __velarBrowserWindow, [name, callback, options], "global addEventListener");
  return () => __velarBrowserCallCaptured(__velarBrowserGlobalRemoveEventListener, __velarBrowserWindow, [name, callback, options?.capture ?? false], "global removeEventListener");
}
`.trimStart();

const storageHostRuntime = String.raw`
${webHostAbiRuntime}
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
`.trimStart();

const runtimeTypeRuntime = VELAR_TYPE_REGISTRY_RUNTIME;

export const webModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/look", String.raw`
${runtimeTypeRuntime}

const lookMissingField = Object.freeze({});
const lookReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const lookGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const lookRegExpTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")?.value;
function lookOwnData(value, name) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")
    || typeof lookReflectApply !== "function" || typeof lookGetOwnPropertyDescriptor !== "function") return lookMissingField;
  const descriptor = lookReflectApply(lookGetOwnPropertyDescriptor, Object, [value, name]);
  return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : lookMissingField;
}
function lookMatches(pattern, value) {
  return typeof lookReflectApply === "function" && typeof lookRegExpTest === "function"
    ? lookReflectApply(lookRegExpTest, pattern, [value])
    : false;
}
function lookText(value, label) {
  if (typeof value !== "string") throw new TypeError(label + " must be text");
  if (value.length === 0 || value.length > 65536) throw new RangeError(label + " must contain 1 through 65536 characters");
  return value;
}
function lookFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label + " must be a finite number");
  return value;
}
function lookRange(value, label, minimum, maximum) {
  value = lookFinite(value, label);
  if (value < minimum || value > maximum) throw new RangeError(label + " must be from " + minimum + " through " + maximum);
  return value;
}
function lookVisual(value, label) {
  if (typeof value === "number") return String(lookFinite(value, label));
  return lookText(value, label);
}
function lookResult(value) {
  if (value.length > 1024 * 1024) throw new RangeError("A constructed Look value cannot exceed 1 MiB");
  return value;
}
function lookType(name, predicate) {
  return __velarRegisterRuntimeType(Object.freeze({
    is(value) { return predicate(value); },
    parse(value) {
      if (!predicate(value)) throw new TypeError(name + " received an invalid visual value");
      return value;
    },
  }));
}
const lengthPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax)$/;
const percentagePattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)%$/;
const trackFractionPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)fr$/;
const durationPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/;
const anglePattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|turn)$/;
const calculatedLengthPattern = /^(?:calc|min|max|clamp)\(/;
const textVisual = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024 * 1024;

export const Look = lookType("Look", (value) => value !== null && typeof value === "object" && lookOwnData(value, "__velarLook") === true);
export const Length = lookType("Length", (value) => typeof value === "string" && (lookMatches(lengthPattern, value) || lookMatches(calculatedLengthPattern, value)));
export const Percentage = lookType("Percentage", (value) => typeof value === "string" && lookMatches(percentagePattern, value));
export const LengthPercentage = lookType("LengthPercentage", (value) => typeof value === "string" && (lookMatches(lengthPattern, value) || lookMatches(percentagePattern, value) || lookMatches(calculatedLengthPattern, value)));
export const TrackFraction = lookType("TrackFraction", (value) => typeof value === "string" && lookMatches(trackFractionPattern, value));
export const Duration = lookType("Duration", (value) => typeof value === "string" && lookMatches(durationPattern, value));
export const Angle = lookType("Angle", (value) => typeof value === "string" && lookMatches(anglePattern, value));
export const Opacity = lookType("Opacity", (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
export const Color = lookType("Color", textVisual);
export const Border = lookType("Border", textVisual);
export const Shadow = lookType("Shadow", textVisual);
export const Image = lookType("Image", textVisual);
export const Track = lookType("Track", textVisual);
export const TrackList = lookType("TrackList", textVisual);
export const Transition = lookType("Transition", textVisual);
export const Spacing = lookType("Spacing", textVisual);
export const Keyframes = lookType("Keyframes", (value) => lookOwnData(value, "__velarKeyframes") === true
  && typeof lookOwnData(value, "name") === "string");
export const Animation = lookType("Animation", (value) => lookOwnData(value, "__velarAnimation") === true
  && typeof lookOwnData(value, "css") === "string");

export function color(value) { return lookText(value, "Color"); }
export function rgb(red, green, blue) {
  const channels = [red, green, blue].map((value, index) => lookRange(value, "RGB channel " + (index + 1), 0, 255));
  return lookResult("rgb(" + channels.join(" ") + ")");
}
export function rgba(red, green, blue, alpha) {
  const channels = [red, green, blue].map((value, index) => lookRange(value, "RGB channel " + (index + 1), 0, 255));
  return lookResult("rgb(" + channels.join(" ") + " / " + lookRange(alpha, "RGB alpha", 0, 1) + ")");
}
export function hsl(hue, saturation, lightness) {
  return lookResult("hsl(" + lookFinite(hue, "HSL hue") + " " + lookRange(saturation, "HSL saturation", 0, 100)
    + "% " + lookRange(lightness, "HSL lightness", 0, 100) + "%)");
}
export function alpha(value, opacity) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + " " + (lookRange(opacity, "Color opacity", 0, 1) * 100) + "%, transparent)");
}
export function lighten(value, amount) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + ", white " + (lookRange(amount, "Color amount", 0, 1) * 100) + "%)");
}
export function darken(value, amount) {
  return lookResult("color-mix(in srgb, " + lookText(value, "Color") + ", black " + (lookRange(amount, "Color amount", 0, 1) * 100) + "%)");
}
export function border(width, value, style = "solid") {
  if (typeof style !== "string" || !["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"].includes(style)) {
    throw new TypeError("Border style is invalid");
  }
  return lookResult(lookVisual(width, "Border width") + " " + style + " " + lookText(value, "Border color"));
}
export function shadow(x, y, blur, value, spread = "0px", inset = false) {
  if (typeof inset !== "boolean") throw new TypeError("Shadow inset must be bool");
  return lookResult((inset ? "inset " : "") + lookVisual(x, "Shadow x") + " " + lookVisual(y, "Shadow y") + " "
    + lookVisual(blur, "Shadow blur") + " " + lookVisual(spread, "Shadow spread") + " " + lookText(value, "Shadow color"));
}
export function linearGradient(angle, start, end) {
  return lookResult("linear-gradient(" + lookVisual(angle, "Gradient angle") + ", " + lookText(start, "Gradient start") + ", " + lookText(end, "Gradient end") + ")");
}
export function asset(path) { return lookResult("url(" + JSON.stringify(lookText(path, "Asset path")) + ")"); }
export function minmax(minimum, maximum) { return lookResult("minmax(" + lookVisual(minimum, "Minimum track") + ", " + lookVisual(maximum, "Maximum track") + ")"); }
export function repeat(count, size) { return lookResult("repeat(" + lookVisual(count, "Repeat count") + ", " + lookVisual(size, "Repeat size") + ")"); }
export function tracks(first, ...rest) {
  const values = [first, ...rest];
  if (values.length > 1024) throw new RangeError("tracks cannot contain more than 1024 values");
  return lookResult(values.map((value, index) => lookVisual(value, "Track " + (index + 1))).join(" "));
}
export function transition(property, duration, easing = "ease", delay) {
  const suffix = delay === undefined ? "" : " " + lookVisual(delay, "Transition delay");
  return lookResult(lookText(property, "Transition property") + " " + lookVisual(duration, "Transition duration") + " " + lookText(easing, "Transition easing") + suffix);
}
export function spacing(first, second, third, fourth) {
  return lookResult([first, second, third, fourth].filter((value) => value !== undefined)
    .map((value, index) => lookVisual(value, "Spacing value " + (index + 1))).join(" "));
}
export function min(first, second) { return lookResult("min(" + lookVisual(first, "min value") + ", " + lookVisual(second, "min value") + ")"); }
export function max(first, second) { return lookResult("max(" + lookVisual(first, "max value") + ", " + lookVisual(second, "max value") + ")"); }
export function clamp(minimum, preferred, maximum) {
  return lookResult("clamp(" + lookVisual(minimum, "clamp minimum") + ", " + lookVisual(preferred, "clamp preferred") + ", " + lookVisual(maximum, "clamp maximum") + ")");
}
export function animate(frames, duration, easing = "ease", delay = "0ms", count = 1, loop = false, direction = "normal", fill = "none") {
  if (lookOwnData(frames, "__velarKeyframes") !== true) throw new TypeError("animate frames must be a Keyframes value");
  const name = lookText(lookOwnData(frames, "name"), "Keyframes name");
  if (!lookMatches(durationPattern, duration)) throw new TypeError("Animation duration must be a Duration value");
  if (!lookMatches(durationPattern, delay)) throw new TypeError("Animation delay must be a Duration value");
  if (!["linear", "ease", "ease-in", "ease-out", "ease-in-out", "step-start", "step-end"].includes(easing)) throw new TypeError("Animation easing is invalid");
  if (!["normal", "reverse", "alternate", "alternate-reverse"].includes(direction)) throw new TypeError("Animation direction is invalid");
  if (!["none", "forwards", "backwards", "both"].includes(fill)) throw new TypeError("Animation fill is invalid");
  if (typeof loop !== "boolean") throw new TypeError("Animation loop must be bool");
  count = lookFinite(count, "Animation count");
  if (!Number.isInteger(count) || count <= 0 || count > 1000000) throw new RangeError("Animation count must be a positive integer no greater than 1000000");
  const css = [name, duration, easing, delay, loop ? "infinite" : String(count), direction, fill].join(" ");
  return Object.freeze({ __velarAnimation: true, css: lookResult(css) });
}
  `.trimStart()],
  ["velar/app", String.raw`
${WEB_RUNTIME_FOUNDATION}

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
  `.trimStart()],
  ["velar/config", String.raw`
${runtimeTypeRuntime}
const source = "__VELAR_PUBLIC_CONFIG__";
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
const value = freeze(source);
export function publicConfig(Type) { Type = __velarRequireRuntimeType(Type, "publicConfig"); return Type.parse(value); }
export function has(key) { if (typeof key !== "string") throw new TypeError("Config keys must be strings"); return Object.prototype.hasOwnProperty.call(value, key); }
export function keys() { return Object.keys(value).sort(); }
`.trimStart()],
  ["velar/web", String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
${browserHostRuntime}
${WEB_DOM_HOST_RUNTIME}
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
  const runtime = globalThis[Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})];
  if (runtime && typeof runtime.report === "function") runtime.report(error, { phase: "event", detail: "link", unhandled: true });
  else __velarEnqueue(() => { throw error; });
}

export function domId(prefix = "velar") {
  prefix = __velarString(prefix, "DOM ID prefix");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(prefix)) throw new TypeError("DOM ID prefixes must start with a letter and contain only letters, numbers, underscores, or hyphens");
  if (prefix.length > 64) throw new RangeError("DOM ID prefixes cannot exceed 64 characters");
  if (!Number.isSafeInteger(nextDomId)) throw new RangeError("The VelarScript DOM ID space is exhausted");
  return prefix + "-" + nextDomId++;
}

function isBoundedStringMap(value) {
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { return false; }
  if (size > 100000) return false;
  let codeUnits = 0;
  for (const [key, item] of Map.prototype.entries.call(value)) {
    if (typeof key !== "string" || typeof item !== "string") return false;
    codeUnits += key.length + item.length;
    if (codeUnits > 2 * 1024 * 1024) return false;
  }
  return true;
}

function checkedRouteContext(value) {
  try {
    const fields = __velarOptions(value, "RouteContext", __velarOptionFields(["path", "params", "query", "hash"]));
    if (Object.keys(fields).length !== 4 || typeof fields.path !== "string" || fields.path.length > 2 * 1024 * 1024
      || !isBoundedStringMap(fields.params) || !isBoundedStringMap(fields.query)
      || typeof fields.hash !== "string" || fields.hash.length > 2 * 1024 * 1024) return null;
    return value;
  } catch { return null; }
}

export const RouteContext = __velarRegisterRuntimeType(Object.freeze({
  is(value) { return checkedRouteContext(value) !== null; },
  parse(value) {
    if (checkedRouteContext(value) === null) throw new TypeError("RouteContext requires bounded path/hash text and string params/query Maps");
    return value;
  },
}));

function validateRoutePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("A VelarScript route path must start with '/'");
  if (path.length > 8192) throw new RangeError("A VelarScript route path cannot exceed 8192 code units");
  if (path.includes("?") || path.includes("#")) throw new TypeError("A VelarScript route path describes only a pathname");
  if (path.includes("\\")) throw new TypeError("A VelarScript route path cannot contain a backslash");
  if (path.length > 1 && path.endsWith("/")) throw new TypeError("A VelarScript route path cannot end with '/'");
  const names = new Set();
  const segments = path.split("/").slice(1);
  for (const [index, segment] of segments.entries()) {
    if (!segment && path !== "/") throw new TypeError("A VelarScript route path cannot contain an empty segment");
    if (segment === "*") {
      if (index !== segments.length - 1) throw new TypeError("A VelarScript route wildcard must be the final segment");
      if (names.has("wildcard")) throw new TypeError("A VelarScript route parameter named 'wildcard' conflicts with the '*' capture");
      names.add("wildcard");
      continue;
    }
    if (segment.includes("*")) throw new TypeError("A VelarScript route wildcard must occupy its whole final segment");
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError("A VelarScript route parameter requires a valid name");
    if (names.has(name)) throw new TypeError("A VelarScript route parameter cannot be repeated: " + name);
    names.add(name);
  }
  return path;
}

function compileRoutePath(path) {
  const names = [];
  const source = path.split("/").map((part) => {
    if (part === "*") { names.push("wildcard"); return "(.*)"; }
    if (part.startsWith(":")) { names.push(part.slice(1)); return "([^/]+)"; }
    return part.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  }).join("/");
  return Object.freeze({ names: Object.freeze(names), pattern: new RegExp("^" + source + "/?$") });
}

export function route(path, component) {
  path = validateRoutePath(path);
  if (typeof component !== "function") throw new TypeError("A VelarScript route component must be callable");
  return Object.freeze({ path, component });
}

export function lazy(loader, exportName, loading = null, failed = null) {
  if (typeof loader !== "function") throw new TypeError("VelarScript lazy requires a module loader");
  if (typeof exportName !== "string" || !exportName) throw new TypeError("VelarScript lazy requires an exported component name");
  if (exportName.length > 4096) throw new RangeError("VelarScript lazy export names cannot exceed 4096 characters");
  if (loading != null && typeof loading !== "function") throw new TypeError("VelarScript lazy loading fallback must be a component");
  if (failed != null && typeof failed !== "function") throw new TypeError("VelarScript lazy failure fallback must be a component");

  let resolved = null;
  let pending = null;
  const load = () => {
    if (resolved) return Promise.resolve(resolved);
    if (!pending) {
      pending = Promise.resolve().then(loader).then((module) => {
        const target = module && module[exportName];
        if (typeof target !== "function") throw new TypeError("Dynamically loaded module has no component export '" + exportName + "'");
        resolved = target;
        return target;
      }).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };

  return function VelarLazy(props = {}, namespace = "html") {
    const svg = namespace === "svg";
    const host = svg
      ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "g")
      : __velarDomCreateElement("velar-lazy");
    if (!svg) host.style.display = "contents";
    let active = loading ? loading({}, namespace) : null;
    if (active != null && !active.__velarComponent) throw new TypeError("VelarScript lazy loading fallback must render a component");
    let mounted = false;
    let destroyed = false;
    if (active && active.__velarComponent) __velarDomAppend(host, active.node);
    else __velarDomAppend(host, __velarDomCreateComment("lazy component loading"));

    const replace = (next) => {
      if (!next || !next.__velarComponent) throw new TypeError("VelarScript lazy fallbacks must render components");
      if (destroyed) { next.destroy(); return; }
      if (active && active.__velarComponent) active.destroy(false);
      active = next;
      __velarDomReplaceChildren(host, next.node);
      if (mounted) next.__mount();
    };

    const fail = (value) => {
      const error = __velarNormalizeError(value);
      const runtime = globalThis[Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})];
      runtime?.report?.(error, { phase: "resource", detail: "lazy:" + exportName, component: exportName, unhandled: false });
      try {
        if (failed) replace(failed({ error }, namespace));
        else {
          const message = svg
            ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "text")
            : __velarDomCreateElement("div");
          __velarDomSetAttribute(message, "role", "alert");
          __velarDomSetText(message, "Unable to load " + exportName);
          replace(component(message));
        }
      } catch (fallbackFailure) {
        const fallbackError = __velarNormalizeError(fallbackFailure);
        runtime?.report?.(fallbackError, { phase: "render", detail: "lazy-fallback:" + exportName, component: exportName, unhandled: false });
        if (active && active.__velarComponent) active.destroy(false);
        active = null;
        if (!destroyed) {
          const message = svg
            ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "text")
            : __velarDomCreateElement("div");
          __velarDomSetAttribute(message, "role", "alert");
          __velarDomSetText(message, "Unable to render " + exportName);
          __velarDomReplaceChildren(host, message);
        }
      }
    };

    void load().then((target) => replace(target(props, namespace))).catch(fail);

    return component(host, () => {
      mounted = true;
      if (active && active.__velarComponent) active.__mount();
    }, () => {
      destroyed = true;
      if (active && active.__velarComponent) active.destroy(false);
    });
  };
}

export function navigate(to, options = {}) {
  options = __velarOptions(options, "Navigation options", __velarOptionFields(["replace", "scroll"]));
  const replace = options.replace ?? false;
  const scroll = options.scroll ?? true;
  __velarBool(replace, "Navigation replace");
  __velarBool(scroll, "Navigation scroll");
  const href = internalHref(to);
  if (replace) __velarBrowserCall(__velarBrowserHistory, "replaceState", __velarBrowserHistoryReplace, __velarBrowserHistoryConstructor, [null, "", href]);
  else __velarBrowserCall(__velarBrowserHistory, "pushState", __velarBrowserHistoryPush, __velarBrowserHistoryConstructor, [null, "", href]);
  if (typeof __velarBrowserPopStateEventConstructor !== "function") throw new TypeError("The browser PopStateEvent API is unavailable");
  const event = new __velarBrowserPopStateEventConstructor("popstate");
  __velarBrowserCallCaptured(__velarBrowserGlobalDispatchEvent, __velarBrowserWindow, [event], "dispatchEvent");
  if (scroll) __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [() => {
    __velarBrowserCallCaptured(__velarBrowserScrollTo, __velarBrowserWindow, [{ top: 0, left: 0 }], "scrollTo");
  }], "requestAnimationFrame");
  return null;
}

export function redirect(to) {
  return navigate(to, { replace: true });
}

export function back() {
  __velarBrowserCall(__velarBrowserHistory, "back", __velarBrowserHistoryBack, __velarBrowserHistoryConstructor);
  return null;
}

export function forward() {
  __velarBrowserCall(__velarBrowserHistory, "forward", __velarBrowserHistoryForward, __velarBrowserHistoryConstructor);
  return null;
}

export function reload() {
  __velarBrowserCall(__velarBrowserLocation, "reload", __velarBrowserLocationReload, __velarBrowserLocationConstructor);
  return null;
}

export function currentRoute() {
  const path = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname)) ?? "/";
  return Object.freeze({ path, params: new Map(), query: queryValues(), hash: routeHash() });
}

export function Head(props) {
  props = __velarOptions(props, "Head props", __velarOptionFields(["title", "description", "canonical", "robots", "image", "themeColor", "language"]));
  let { title, description = "", canonical = "", robots = "", image = "", themeColor = "", language = "" } = props;
  title = __velarString(title, "Head title");
  description = __velarString(description, "Head description");
  canonical = __velarString(canonical, "Head canonical URL");
  robots = __velarString(robots, "Head robots");
  image = __velarString(image, "Head image");
  themeColor = __velarString(themeColor, "Head theme color");
  language = __velarString(language, "Head language");
  if (title.length > 4096) throw new RangeError("Head titles cannot exceed 4096 characters");
  if (description.length > 65536) throw new RangeError("Head descriptions cannot exceed 64 KiB");
  if (canonical.length > 2 * 1024 * 1024 || image.length > 2 * 1024 * 1024) throw new RangeError("Head URLs cannot exceed 2 MiB");
  if (robots.length > 4096) throw new RangeError("Head robots cannot exceed 4096 characters");
  if (themeColor.length > 256) throw new RangeError("Head theme colors cannot exceed 256 characters");
  if (language.length > 256) throw new RangeError("Head language tags cannot exceed 256 characters");
  if (language && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)) {
    throw new TypeError("Head language must be a simple BCP 47 language tag");
  }
  const node = document.createComment("velar head");
  let previousTitle = "";
  let previousLanguage = null;
  let restorers = [];
  return component(node, () => {
    previousTitle = document.title;
    document.title = title;
    previousLanguage = document.documentElement.getAttribute("lang");
    if (language) document.documentElement.setAttribute("lang", language);
    restorers = [
      ownHead('meta[name="description"]', "meta", "name", "description", "content", description),
      ownHead('link[rel="canonical"]', "link", "rel", "canonical", "href", canonical),
      ownHead('meta[name="robots"]', "meta", "name", "robots", "content", robots),
      ownHead('meta[property="og:image"]', "meta", "property", "og:image", "content", image),
      ownHead('meta[name="theme-color"]', "meta", "name", "theme-color", "content", themeColor),
    ];
  }, () => {
    if (document.title === title) document.title = previousTitle;
    if (language && document.documentElement.getAttribute("lang") === language) {
      if (previousLanguage == null) document.documentElement.removeAttribute("lang");
      else document.documentElement.setAttribute("lang", previousLanguage);
    }
    for (const restore of restorers.reverse()) restore();
  });
}

function ownHead(selector, tag, identityName, identityValue, valueName, value) {
  if (!value) return () => {};
  let element = document.head.querySelector(selector);
  const created = !element;
  if (!element) {
    element = document.createElement(tag);
    element.setAttribute(identityName, identityValue);
    document.head.append(element);
  }
  const previous = element.getAttribute(valueName);
  element.setAttribute(valueName, value);
  return () => {
    if (element.getAttribute(valueName) !== value) return;
    if (created) element.remove();
    else if (previous == null) element.removeAttribute(valueName);
    else element.setAttribute(valueName, previous);
  };
}

export function announce(message, priority = "polite") {
  message = __velarString(message, "Announcement message");
  if (message.length > 65536) throw new RangeError("Announcement messages cannot exceed 64 KiB");
  if (priority !== "polite" && priority !== "assertive") throw new TypeError("Announcement priority must be 'polite' or 'assertive'");
  let region = document.querySelector('[data-velar-announcer="' + priority + '"]');
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("data-velar-announcer", priority);
    region.setAttribute("role", priority === "assertive" ? "alert" : "status");
    region.setAttribute("aria-live", priority);
    region.setAttribute("aria-atomic", "true");
    region.style.cssText = "position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.append(region);
  }
  region.textContent = "";
  __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [() => { region.textContent = message; }], "requestAnimationFrame");
  return null;
}

export function Router(props) {
  props = __velarOptions(props, "Router props", __velarOptionFields(["routes", "fallback"]));
  let { routes, fallback = null } = props;
  const routeItems = __velarRequireList(routes, "Router routes");
  if (routeItems.length > 10000) throw new RangeError("A Router cannot contain more than 10000 routes");
  routes = routeItems.map((item) => {
    item = __velarOptions(item, "Router route", __velarOptionFields(["path", "component"]));
    validateRoutePath(item.path);
    if (typeof item.component !== "function") throw new TypeError("A Router route component must be callable");
    return Object.freeze({ path: item.path, component: item.component, matcher: compileRoutePath(item.path) });
  });
  if (fallback != null && typeof fallback !== "function") throw new TypeError("A Router fallback must be a component");
  const node = __velarDomCreateElement("velar-router");
  let active = null;
  let mounted = false;
  const notFound = ({ route }) => {
    const page = __velarDomCreateElement("main");
    __velarDomSetAttribute(page, "data-velar-not-found", "");
    const title = __velarDomCreateElement("h1");
    __velarDomSetText(title, "Page not found");
    const detail = __velarDomCreateElement("p");
    __velarDomSetText(detail, "No route matches " + route.path);
    __velarDomAppend(page, title, detail);
    return component(page);
  };
  const render = () => {
    try {
      const path = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname));
      const match = path === null ? null : matchRoute(routes, path);
      const context = match?.context ?? { path: path ?? "/", params: new Map(), query: queryValues(), hash: routeHash() };
      const next = match ? match.item.component({ route: context }) : (fallback ?? notFound)({ route: context });
      if (!next || !next.__velarComponent) throw new TypeError("A VelarScript Router target must render a component");
      if (active) active.destroy();
      active = next;
      __velarDomReplaceChildren(node, active.node);
      if (mounted) active.__mount();
    } catch (value) {
      const error = __velarNormalizeError(value);
      if (!mounted) throw error;
      const runtime = globalThis[Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})];
      if (runtime && typeof runtime.report === "function") {
        runtime.report(error, { phase: "render", detail: "router", component: "Router", unhandled: true });
      } else {
        __velarEnqueue(() => { throw error; });
      }
    }
  };
  const changed = () => render();
  let removeRouteListener = null;
  render();
  return component(node, () => {
    mounted = true;
    removeRouteListener = __velarBrowserListenGlobal("popstate", changed);
    if (active) active.__mount();
  }, () => {
    if (removeRouteListener) removeRouteListener();
    if (active) active.destroy(false);
  });
}

export function Link(props) {
  props = __velarOptions(props, "Link props", __velarOptionFields(["to", "replace", "class", "look", "children"]));
  let { to, replace = false, children } = props;
  to = __velarString(to, "Link target");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("Link targets cannot exceed 2 MiB");
  __velarBool(replace, "Link replace");
  const external = isExternal(to);
  const href = external ? to : internalHref(to);
  const node = __velarDomCreateElement("a");
  const releaseHost = forwardHost(node, props);
  node.href = href;
  append(node, children);
  const clicked = (event) => {
    try {
      const defaultPrevented = webEventField(event, "defaultPrevented", webEventDefaultPrevented);
      const button = webEventField(event, "button", webEventButton);
      const metaKey = webEventField(event, "metaKey", webEventMetaKey);
      const ctrlKey = webEventField(event, "ctrlKey", webEventCtrlKey);
      const shiftKey = webEventField(event, "shiftKey", webEventShiftKey);
      const altKey = webEventField(event, "altKey", webEventAltKey);
      if (defaultPrevented === webEventMissingField || button === webEventMissingField || metaKey === webEventMissingField
        || ctrlKey === webEventMissingField || shiftKey === webEventMissingField || altKey === webEventMissingField
        || typeof defaultPrevented !== "boolean" || !Number.isSafeInteger(button)
        || typeof metaKey !== "boolean" || typeof ctrlKey !== "boolean" || typeof shiftKey !== "boolean" || typeof altKey !== "boolean") {
        throw new TypeError("Link received an invalid click event");
      }
      if (defaultPrevented || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return;
      if (external) return;
      if (webUrlField(webUrl(node.href, webLocationField("href", __velarBrowserLocationHref)), "origin", __velarBrowserUrlOrigin)
        !== webLocationField("origin", __velarBrowserLocationOrigin)) return;
      webEventCall(event, "preventDefault", webEventPreventDefault);
      navigate(to, { replace });
    } catch (failure) { reportLinkEventFailure(failure); }
  };
  let removeClick = null;
  return component(node, () => { removeClick = __velarBrowserListen(node, "click", clicked); }, () => { if (removeClick) removeClick(); releaseHost(); });
}

export function NavLink(props) {
  props = __velarOptions(props, "NavLink props", __velarOptionFields(["to", "exact", "replace", "class", "look", "children"]));
  let { to, exact = false, replace = false, children } = props;
  to = __velarString(to, "NavLink target");
  __velarBool(exact, "NavLink exact");
  __velarBool(replace, "NavLink replace");
  internalHref(to);
  const linked = Link({ to, replace, class: props.class, look: props.look, children });
  const target = normalizeApplicationPath(webUrlField(webUrl(to, "https://velar.invalid"), "pathname", __velarBrowserUrlPathname));
  const update = () => {
    const application = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname));
    const current = application === null ? null : normalizeApplicationPath(application);
    const active = current !== null && (current === target || (!exact && target !== "/" && current.startsWith(target + "/")));
    if (active) __velarDomSetAttribute(linked.node, "aria-current", "page");
    else __velarDomRemoveAttribute(linked.node, "aria-current");
  };
  let removeRouteListener = null;
  update();
  return component(linked.node, () => {
    linked.__mount();
    removeRouteListener = __velarBrowserListenGlobal("popstate", update);
  }, () => {
    if (removeRouteListener) removeRouteListener();
    linked.destroy(false);
  });
}

// These runtime-implemented components read their props exactly once at
// construction; the emitted instantiation path snapshots each prop thunk for
// them instead of building a live reactive props store, so their strict
// record validation keeps rejecting accessor fields.
Head.__velarSnapshotProps = true;
Router.__velarSnapshotProps = true;
Link.__velarSnapshotProps = true;
NavLink.__velarSnapshotProps = true;

function forwardHost(node, props) {
  const cleanups = [];
  if (props.class != null) {
    if (typeof props.class !== "string") throw new TypeError("Link class must be a string");
    const names = props.class.split(/\s+/).filter(Boolean);
    node.classList.add(...names);
    cleanups.push(() => node.classList.remove(...names));
  }
  if (props.look != null) {
    const runtime = globalThis[Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})];
    if (!runtime || typeof runtime.applyLook !== "function") throw new TypeError("Link Look requires the VelarScript Web runtime");
    cleanups.push(runtime.applyLook(node, props.look));
  }
  return () => { for (const cleanup of cleanups.reverse()) cleanup(); };
}

function normalizeApplicationPath(path) {
  return path.length > 1 ? path.replace(/\/+$/u, "") : "/";
}

function matchRoute(routes, pathname) {
  for (const item of routes) {
    const result = item.matcher.pattern.exec(pathname);
    if (!result) continue;
    const params = new Map();
    let decodable = true;
    for (const [index, name] of item.matcher.names.entries()) {
      try { params.set(name, decodeURIComponent(result[index + 1] ?? "")); }
      catch { decodable = false; break; }
    }
    if (!decodable) continue;
    return { item, context: { path: pathname, params, query: queryValues(), hash: routeHash() } };
  }
  return null;
}

function applicationPath(pathname) {
  if (typeof pathname !== "string" || pathname.length > 2 * 1024 * 1024) throw new RangeError("Application paths cannot exceed 2 MiB");
  if (appBase === "/") return pathname;
  const prefix = appBase.slice(0, -1);
  if (pathname === prefix) return "/";
  return pathname.startsWith(appBase) ? "/" + pathname.slice(appBase.length) : null;
}

function internalHref(to) {
  if (typeof to !== "string" || !to.startsWith("/") || isExternal(to)) throw new TypeError("VelarScript navigation targets must be application paths starting with '/'");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("VelarScript navigation targets cannot exceed 2 MiB");
  const parsed = webUrl(to, "https://velar.invalid");
  const pathname = webUrlField(parsed, "pathname", __velarBrowserUrlPathname);
  const search = webUrlField(parsed, "search", __velarBrowserUrlSearch);
  const hash = webUrlField(parsed, "hash", __velarBrowserUrlHash);
  return appBase + pathname.slice(1) + search + hash;
}

function isExternal(to) {
  return typeof to === "string" && (/^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//"));
}

function queryValues() {
  const search = webLocationField("search", __velarBrowserLocationSearch);
  if (typeof search !== "string") throw new TypeError("Route queries require browser text");
  if (search.length > 2 * 1024 * 1024) throw new RangeError("Route queries cannot exceed 2 MiB");
  const output = new Map();
  let count = 0;
  if (typeof __velarBrowserUrlSearchParamsConstructor !== "function" || typeof __velarBrowserUrlSearchParamsForEach !== "function") {
    throw new TypeError("The browser URLSearchParams API is unavailable");
  }
  const params = new __velarBrowserUrlSearchParamsConstructor(search);
  __velarBrowserCallCaptured(__velarBrowserUrlSearchParamsForEach, params, [(value, name) => {
    count += 1;
    if (count > 100000) throw new RangeError("Route queries cannot exceed 100000 fields");
    output.set(name, value);
  }], "URLSearchParams.forEach");
  return output;
}

function routeHash() {
  const hash = webLocationField("hash", __velarBrowserLocationHash);
  if (typeof hash !== "string") throw new TypeError("Route hashes require browser text");
  if (hash.length > 2 * 1024 * 1024) throw new RangeError("Route hashes cannot exceed 2 MiB");
  return hash;
}

function component(node, mounted, cleanup) {
  let destroyed = false;
  let ready = false;
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
      if (ready) throw new Error("Cannot mount a VelarScript component more than once");
      const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      __velarDomInsertBefore(parent, node, before);
      this.__mount();
      return null;
    },
    __mount() { if (!destroyed && !ready) { ready = true; if (mounted) mounted(); } },
    destroy(remove = true) { if (!destroyed) { destroyed = true; if (cleanup) cleanup(); if (remove) __velarDomRemove(node); } return null; },
  };
}

function append(parent, value, state = null) {
  state ??= { active: __velarDomCreateSet(), depth: 0, values: 0, text: 0 };
  if (value == null || value === false || value === true) return;
  state.values += 1;
  if (state.values > 1000000) throw new RangeError("JSX cannot render more than 1000000 values");
  if (typeof value === "string") {
    state.text += value.length;
    if (state.text > 16 * 1024 * 1024) throw new RangeError("JSX text cannot exceed 16 MiB");
    __velarDomAppend(parent, __velarDomCreateTextNode(value));
    return;
  }
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX numbers must be finite");
    __velarDomAppend(parent, __velarDomCreateTextNode(__velarDomString(value)));
    return;
  }
  if (__velarDomIsNode(value)) { __velarDomAppend(parent, value); return; }
  if (__velarDomIsArray(value)) {
    if (state.depth >= 128) throw new RangeError("JSX Lists cannot exceed 128 nested levels");
    if (__velarDomSetContains(state.active, value)) throw new TypeError("JSX cannot render a cyclic List");
    const values = __velarRequireList(value, "JSX children");
    __velarDomSetInsert(state.active, value);
    state.depth += 1;
    try { for (const item of values) append(parent, item, state); }
    finally { state.depth -= 1; __velarDomSetRemove(state.active, value); }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}
`.trimStart()],
  ["velar/forms", String.raw`
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
const NativeFormElement = typeof globalThis.HTMLFormElement === "function" ? globalThis.HTMLFormElement : null;
const NativeFormData = typeof globalThis.FormData === "function" ? globalThis.FormData : null;
const NativeFormMap = typeof globalThis.Map === "function" ? globalThis.Map : null;
const NativeFormWeakMap = typeof globalThis.WeakMap === "function" ? globalThis.WeakMap : null;
const NativeFormNumber = typeof globalThis.Number === "function" ? globalThis.Number : null;
const NativeFormNode = typeof globalThis.Node === "function" ? globalThis.Node : null;
const NativeFormElementBase = typeof globalThis.Element === "function" ? globalThis.Element : null;
const NativeFormHtmlElement = typeof globalThis.HTMLElement === "function" ? globalThis.HTMLElement : null;
const NativeFormDocumentConstructor = typeof globalThis.Document === "function" ? globalThis.Document : null;
const NativeFormDocument = globalThis.document ?? null;
const NativeFormHtmlCollection = typeof globalThis.HTMLCollection === "function" ? globalThis.HTMLCollection : null;
const NativeFormNodeList = typeof globalThis.NodeList === "function" ? globalThis.NodeList : null;
const NativeFormInput = typeof globalThis.HTMLInputElement === "function" ? globalThis.HTMLInputElement : null;
const NativeFormButton = typeof globalThis.HTMLButtonElement === "function" ? globalThis.HTMLButtonElement : null;
const NativeFormSelect = typeof globalThis.HTMLSelectElement === "function" ? globalThis.HTMLSelectElement : null;
const NativeFormTextArea = typeof globalThis.HTMLTextAreaElement === "function" ? globalThis.HTMLTextAreaElement : null;
const NativeFormFieldSet = typeof globalThis.HTMLFieldSetElement === "function" ? globalThis.HTMLFieldSetElement : null;
const NativeFormOptGroup = typeof globalThis.HTMLOptGroupElement === "function" ? globalThis.HTMLOptGroupElement : null;
const NativeFormOption = typeof globalThis.HTMLOptionElement === "function" ? globalThis.HTMLOptionElement : null;
const formReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const formHasInstance = Object.getOwnPropertyDescriptor(Function.prototype, Symbol.hasInstance)?.value;
const formGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const formDefineProperty = Object.getOwnPropertyDescriptor(Object, "defineProperty")?.value;
const formDataGet = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "get")?.value : null;
const formDataGetAll = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "getAll")?.value : null;
const formDataHas = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "has")?.value : null;
const formDataForEach = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "forEach")?.value : null;
const formMapGet = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "get")?.value : null;
const formMapHas = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "has")?.value : null;
const formMapSet = typeof NativeFormMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormMap.prototype, "set")?.value : null;
const formWeakMapGet = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "get")?.value : null;
const formWeakMapHas = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "has")?.value : null;
const formWeakMapSet = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "set")?.value : null;
const formWeakMapDelete = typeof NativeFormWeakMap === "function" ? Object.getOwnPropertyDescriptor(NativeFormWeakMap.prototype, "delete")?.value : null;
const formStringTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")?.value;
const formRegexTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")?.value;
const formRegexSplit = Object.getOwnPropertyDescriptor(RegExp.prototype, Symbol.split)?.value;
const formArrayJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join")?.value;
const formNumberIsFinite = Object.getOwnPropertyDescriptor(Number, "isFinite")?.value;
const formNumberIsSafeInteger = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")?.value;
const formElementOwner = NativeFormElementBase ?? NativeFormElement;
const formHtmlOwner = NativeFormHtmlElement ?? NativeFormElement;
const formDocumentCreateElement = typeof NativeFormDocumentConstructor === "function"
  ? Object.getOwnPropertyDescriptor(NativeFormDocumentConstructor.prototype, "createElement")?.value
  : NativeFormDocument && typeof NativeFormDocument === "object" ? Object.getOwnPropertyDescriptor(NativeFormDocument, "createElement")?.value : null;
const formElementGetAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "getAttribute")?.value : null;
const formElementSetAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "setAttribute")?.value : null;
const formElementRemoveAttribute = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "removeAttribute")?.value : null;
const formElementInsertAdjacentElement = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "insertAdjacentElement")?.value : null;
const formElementRemove = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "remove")?.value : null;
const formElementQuerySelector = typeof formElementOwner === "function"
  ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "querySelector")?.value ?? Object.getOwnPropertyDescriptor(NativeFormElement?.prototype ?? {}, "querySelector")?.value : null;
const formElementQuerySelectorAll = typeof formElementOwner === "function"
  ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "querySelectorAll")?.value ?? Object.getOwnPropertyDescriptor(NativeFormElement?.prototype ?? {}, "querySelectorAll")?.value : null;
const formHtmlFocus = typeof formHtmlOwner === "function" ? Object.getOwnPropertyDescriptor(formHtmlOwner.prototype, "focus")?.value : null;
const formNativeReset = typeof NativeFormElement === "function" ? Object.getOwnPropertyDescriptor(NativeFormElement.prototype, "reset")?.value : null;
const formElementsGet = typeof NativeFormElement === "function" ? Object.getOwnPropertyDescriptor(NativeFormElement.prototype, "elements")?.get : null;
const formCollectionLengthGet = typeof NativeFormHtmlCollection === "function" ? Object.getOwnPropertyDescriptor(NativeFormHtmlCollection.prototype, "length")?.get : null;
const formCollectionItem = typeof NativeFormHtmlCollection === "function" ? Object.getOwnPropertyDescriptor(NativeFormHtmlCollection.prototype, "item")?.value : null;
const formNodeListLengthGet = typeof NativeFormNodeList === "function" ? Object.getOwnPropertyDescriptor(NativeFormNodeList.prototype, "length")?.get : null;
const formNodeListItem = typeof NativeFormNodeList === "function" ? Object.getOwnPropertyDescriptor(NativeFormNodeList.prototype, "item")?.value : null;
const formNodeTextContent = typeof NativeFormNode === "function" ? Object.getOwnPropertyDescriptor(NativeFormNode.prototype, "textContent") : null;
const formElementId = typeof formElementOwner === "function" ? Object.getOwnPropertyDescriptor(formElementOwner.prototype, "id") : null;
const formControlContracts = [
  NativeFormInput, NativeFormButton, NativeFormSelect, NativeFormTextArea, NativeFormFieldSet, NativeFormOptGroup, NativeFormOption,
].map((constructor) => constructor && typeof constructor === "function" ? {
  constructor,
  name: Object.getOwnPropertyDescriptor(constructor.prototype, "name") ?? null,
  disabled: Object.getOwnPropertyDescriptor(constructor.prototype, "disabled") ?? null,
} : null);
let nextErrorId = 1;
const pendingFields = typeof NativeFormWeakMap === "function" ? new NativeFormWeakMap() : null;
const maxFormFields = 100000;
const maxFormTextCodeUnits = 16 * 1024 * 1024;
function formText(value, name, maximum = 1024) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function formCall(operation, receiver, arguments_, name) {
  if (typeof operation !== "function" || typeof formReflectApply !== "function") {
    throw new TypeError("The browser does not expose native " + name);
  }
  return formReflectApply(operation, receiver, arguments_);
}
function formInstance(constructor, value) {
  if (typeof constructor !== "function" || typeof formHasInstance !== "function" || typeof formReflectApply !== "function") return false;
  try { return formReflectApply(formHasInstance, constructor, [value]); } catch { return false; }
}
function formOwnDescriptor(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof formGetOwnPropertyDescriptor !== "function" || typeof formReflectApply !== "function") return null;
  return formReflectApply(formGetOwnPropertyDescriptor, __velarOptionsNativeObject, [value, name]);
}
function formHostMethod(operation, owner, receiver, arguments_, name) {
  if (formInstance(owner, receiver)) return formCall(operation, receiver, arguments_, name);
  const descriptor = formOwnDescriptor(receiver, name);
  if (descriptor?.enumerable && "value" in descriptor && typeof descriptor.value === "function") {
    return formCall(descriptor.value, receiver, arguments_, name);
  }
  throw new TypeError("The browser does not expose native " + name);
}
function formHostRead(descriptor, owner, receiver, name) {
  if (formInstance(owner, receiver) && typeof descriptor?.get === "function") return formCall(descriptor.get, receiver, [], name);
  const own = formOwnDescriptor(receiver, name);
  if (own?.enumerable && "value" in own) return own.value;
  throw new TypeError("The browser does not expose a data-only " + name);
}
function formHostWrite(descriptor, owner, receiver, name, value) {
  if (formInstance(owner, receiver) && typeof descriptor?.set === "function") {
    formCall(descriptor.set, receiver, [value], name);
    return;
  }
  const own = formOwnDescriptor(receiver, name);
  if (!own?.enumerable || !("value" in own) || !own.writable || typeof formDefineProperty !== "function") {
    throw new TypeError("The browser does not expose a writable data-only " + name);
  }
  formReflectApply(formDefineProperty, __velarOptionsNativeObject, [receiver, name, {...own, value}]);
}
function formControlContract(value, field, writing = false) {
  for (let index = 0; index < formControlContracts.length; index += 1) {
    const contract = formControlContracts[index];
    if (!contract || !formInstance(contract.constructor, value)) continue;
    const descriptor = contract[field];
    if (writing ? typeof descriptor?.set === "function" : typeof descriptor?.get === "function") return [contract.constructor, descriptor];
    throw new TypeError("The browser form control does not expose native " + field);
  }
  return [null, null];
}
function formControlRead(value, field) {
  const [owner, descriptor] = formControlContract(value, field, false);
  return formHostRead(descriptor, owner, value, field);
}
function formControlWrite(value, field, item) {
  const [owner, descriptor] = formControlContract(value, field, true);
  formHostWrite(descriptor, owner, value, field, item);
}
function formSnapshotCollection(value, name, maximum) {
  if (__velarListReflectApply(__velarListArrayIsArray, __velarListNativeArray, [value])) {
    const output = __velarRequireList(value, name);
    if (output.length > maximum) throw new RangeError(name + " cannot exceed " + maximum + " items");
    return output;
  }
  let count;
  let itemOperation;
  if (formInstance(NativeFormHtmlCollection, value)) {
    count = formCall(formCollectionLengthGet, value, [], "HTMLCollection.length");
    itemOperation = formCollectionItem;
  } else if (formInstance(NativeFormNodeList, value)) {
    count = formCall(formNodeListLengthGet, value, [], "NodeList.length");
    itemOperation = formNodeListItem;
  } else {
    const length = formOwnDescriptor(value, "length");
    if (!length?.enumerable || !("value" in length)) throw new TypeError(name + " requires a bounded data-only collection");
    count = length.value;
  }
  if (typeof formNumberIsSafeInteger !== "function" || !formReflectApply(formNumberIsSafeInteger, NativeFormNumber, [count]) || count < 0) {
    throw new TypeError(name + " has an invalid length");
  }
  if (count > maximum) throw new RangeError(name + " cannot exceed " + maximum + " items");
  const output = new __velarListNativeArray(count);
  for (let index = 0; index < count; index += 1) {
    let item;
    if (typeof itemOperation === "function") item = formCall(itemOperation, value, [index], name + ".item");
    else {
      const descriptor = formOwnDescriptor(value, index);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " requires data-only indexed values");
      item = descriptor.value;
    }
    formListSet(output, index, item);
  }
  return output;
}
function formGetAttribute(element, name) { return formHostMethod(formElementGetAttribute, formElementOwner, element, [name], "getAttribute"); }
function formSetAttribute(element, name, value) { return formHostMethod(formElementSetAttribute, formElementOwner, element, [name, value], "setAttribute"); }
function formRemoveAttribute(element, name) { return formHostMethod(formElementRemoveAttribute, formElementOwner, element, [name], "removeAttribute"); }
function formAttributeTokens(value) {
  value = formText(value, "Form accessibility metadata", 65536);
  if (!value) return new __velarListNativeArray();
  const raw = formCall(formRegexSplit, /\s+/u, [value], "RegExp split");
  const input = __velarRequireList(raw, "Form accessibility metadata tokens");
  const output = new __velarListNativeArray();
  const seen = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!seen) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (!token || formCall(formMapHas, seen, [token], "Map.has")) continue;
    formCall(formMapSet, seen, [token, true], "Map.set");
    formListSet(output, output.length, token);
  }
  return output;
}
function formJoinTokens(tokens) { return formCall(formArrayJoin, tokens, [" "], "Array.join"); }
function formData(form) {
  if (typeof NativeFormData !== "function") throw new TypeError("The browser FormData API is unavailable");
  return new NativeFormData(form);
}
function formListSet(values, index, value) {
  __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [values, index, {
    value, enumerable: true, configurable: true, writable: true,
  }]);
}
function formNumber(value) {
  if (typeof value !== "string") return null;
  if (typeof NativeFormNumber !== "function" || typeof formNumberIsFinite !== "function") {
    throw new TypeError("The browser number parsing intrinsics are unavailable");
  }
  const text = formCall(formStringTrim, value, [], "String.trim");
  if (!formCall(formRegexTest, /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u, [text], "RegExp.test")) return null;
  const number = formReflectApply(NativeFormNumber, undefined, [text]);
  return formReflectApply(formNumberIsFinite, NativeFormNumber, [number]) ? number : null;
}
function formValue(value, name) {
  if (typeof value === "string" && value.length > maxFormTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function formList(values, name) {
  const output = __velarRequireList(values, name);
  if (output.length > maxFormFields) throw new RangeError(name + " cannot exceed 100000 values");
  return output;
}
function formElements(form) {
  const elements = formHostRead({get: formElementsGet}, NativeFormElement, form, "elements");
  return formSnapshotCollection(elements, "Form controls", maxFormFields);
}
function formErrorNodes(form) {
  const nodes = formHostMethod(formElementQuerySelectorAll, formElementOwner, form, ["[data-velar-field-error]"], "querySelectorAll");
  return formSnapshotCollection(nodes, "Form field errors", maxFormFields);
}
function formType(value) { return __velarRequireRuntimeType(value, "Form reading"); }
function decoderField(value) {
  value = __velarOptions(value, "Form decoder field", __velarOptionFields(["name", "kind", "optional", "enumValues"]));
  const name = formText(value.name, "Form decoder field name");
  const kind = formText(value.kind, "Form decoder field kind", 64);
  if (kind !== "string" && kind !== "number" && kind !== "bool" && kind !== "enum" && kind !== "strings") {
    throw new TypeError("Form decoder field '" + name + "' uses an unsupported decoder");
  }
  if (typeof value.optional !== "boolean") throw new TypeError("Form decoder optional must be bool");
  let enumValues = null;
  if (kind === "enum") {
    enumValues = __velarRequireList(value.enumValues, "Form enum values");
    if (enumValues.length > maxFormFields) throw new RangeError("Form enum values cannot exceed 100000 entries");
    for (let index = 0; index < enumValues.length; index += 1) {
      if (typeof enumValues[index] !== "string") throw new TypeError("Form enum values must be strings");
    }
  } else if (value.enumValues != null) {
    throw new TypeError("Only enum form decoders can declare enum values");
  }
  return __velarFreezeOptionsValue({ name, kind, optional: value.optional, enumValues });
}

export function values(form) {
  requireForm(form);
  if (typeof NativeFormMap !== "function") throw new TypeError("The browser Map API is unavailable");
  const output = new NativeFormMap();
  let count = 0;
  const data = formData(form);
  formCall(formDataForEach, data, [(value, name) => {
    count += 1;
    if (count > maxFormFields) throw new RangeError("Forms cannot exceed 100000 submitted fields");
    const checkedName = formText(name, "Submitted form field name");
    formValue(value, "Form field '" + checkedName + "'");
    if (!formCall(formMapHas, output, [checkedName], "Map.has")) formCall(formMapSet, output, [checkedName, value], "Map.set");
    else {
      const current = formCall(formMapGet, output, [checkedName], "Map.get");
      if (__velarListReflectApply(__velarListArrayIsArray, __velarListNativeArray, [current])) {
        formListSet(current, current.length, value);
      } else {
        const repeated = new __velarListNativeArray(2);
        formListSet(repeated, 0, current);
        formListSet(repeated, 1, value);
        formCall(formMapSet, output, [checkedName, repeated], "Map.set");
      }
    }
  }], "FormData.forEach");
  return output;
}

export function read(form, type, fields) {
  requireForm(form);
  type = formType(type);
  const decoderItems = __velarRequireList(fields, "Form decoder fields");
  if (decoderItems.length > maxFormFields) throw new RangeError("Form decoders cannot exceed 100000 fields");
  fields = decoderItems;
  for (let index = 0; index < fields.length; index += 1) fields[index] = decoderField(fields[index]);
  const data = formData(form);
  const output = __velarOptionsReflectApply(__velarOptionsCreate, __velarOptionsNativeObject, [null]);
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const field = fields[fieldIndex];
    const name = field.name;
    const value = formValue(formCall(formDataGet, data, [name], "FormData.get"), "Form field '" + name + "'");
    if (field.kind === "string") {
      if (value == null) output[name] = field.optional ? null : "";
      else if (typeof value === "string") output[name] = value;
      else throw new TypeError("Form field '" + name + "' is not textual");
    } else if (field.kind === "number") {
      if (value == null || (typeof value === "string" && formCall(formStringTrim, value, [], "String.trim") === "")) {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a finite number");
      } else {
        const number = formNumber(value);
        if (number === null) throw new TypeError("Form field '" + name + "' requires a finite decimal number");
        output[name] = number;
      }
    } else if (field.kind === "bool") {
      output[name] = formCall(formDataHas, data, [name], "FormData.has");
    } else if (field.kind === "enum") {
      if (value == null || value === "") {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a known enum value");
      } else if (typeof value === "string") {
        let known = false;
        for (let index = 0; index < field.enumValues.length; index += 1) {
          if (field.enumValues[index] === value) { known = true; break; }
        }
        if (!known) throw new TypeError("Form field '" + name + "' requires a known enum value");
        output[name] = value;
      } else {
        throw new TypeError("Form field '" + name + "' requires a known enum value");
      }
    } else if (field.kind === "strings") {
      const items = formList(formCall(formDataGetAll, data, [name], "FormData.getAll"), "Form field '" + name + "'");
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        formValue(item, "Form field '" + name + "'");
        if (typeof item !== "string") throw new TypeError("Form field '" + name + "' is not textual");
      }
      output[name] = items;
    } else {
      throw new TypeError("Form field '" + name + "' uses an unsupported decoder");
    }
  }
  return type.parse(output);
}

export function fieldValue(form, name) {
  return firstValue(form, name);
}

export function textValue(form, name, fallback = "") {
  name = formText(name, "Form field name");
  fallback = formText(fallback, "Form text fallback", maxFormTextCodeUnits);
  const value = firstValue(form, name);
  if (value == null) return fallback;
  if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  return value;
}

export function numberValue(form, name) {
  return formNumber(textValue(form, name));
}

export function checkedValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  return formCall(formDataHas, data, [name], "FormData.has");
}

export function fieldValues(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  const values = formList(formCall(formDataGetAll, data, [name], "FormData.getAll"), "Form field '" + name + "'");
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    formValue(value, "Form field '" + name + "'");
    if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  }
  return values;
}

export function setError(form, name, message) {
  requireForm(form);
  name = formText(name, "Form field name");
  message = formText(message, "Form error message", 65536);
  const field = namedField(form, name);
  if (!field) throw new Error("Form field '" + name + "' was not found");
  const errorNodes = formErrorNodes(form);
  let error = null;
  for (let index = 0; index < errorNodes.length; index += 1) {
    if (formGetAttribute(errorNodes[index], "data-velar-field-error") === name) { error = errorNodes[index]; break; }
  }
  if (!error) {
    error = formHostMethod(formDocumentCreateElement, NativeFormDocumentConstructor, NativeFormDocument, ["p"], "createElement");
    formHostWrite(formElementId, formElementOwner, error, "id", "velar-field-error-" + nextErrorId++);
    formSetAttribute(error, "data-velar-field-error", name);
    formSetAttribute(error, "role", "alert");
    formHostMethod(formElementInsertAdjacentElement, formElementOwner, field, ["afterend", error], "insertAdjacentElement");
  }
  formHostWrite(formNodeTextContent, NativeFormNode, error, "textContent", message);
  formSetAttribute(field, "aria-invalid", "true");
  const described = formAttributeTokens(formGetAttribute(field, "aria-describedby") ?? "");
  const errorId = formText(formHostRead(formElementId, formElementOwner, error, "id"), "Form error id");
  let hasErrorId = false;
  for (let index = 0; index < described.length; index += 1) if (described[index] === errorId) { hasErrorId = true; break; }
  if (!hasErrorId) formListSet(described, described.length, errorId);
  formSetAttribute(field, "aria-describedby", formJoinTokens(described));
  return null;
}

export function clearError(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const field = namedField(form, name);
  const errorNodes = formErrorNodes(form);
  const removedIds = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!removedIds) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < errorNodes.length; index += 1) {
    const error = errorNodes[index];
    if (formGetAttribute(error, "data-velar-field-error") !== name) continue;
    const errorId = formHostRead(formElementId, formElementOwner, error, "id");
    if (typeof errorId === "string" && errorId) formCall(formMapSet, removedIds, [errorId, true], "Map.set");
    formHostMethod(formElementRemove, formElementOwner, error, [], "remove");
  }
  if (field) {
    formRemoveAttribute(field, "aria-invalid");
    const described = formAttributeTokens(formGetAttribute(field, "aria-describedby") ?? "");
    const retained = new __velarListNativeArray();
    for (let index = 0; index < described.length; index += 1) {
      const id = described[index];
      if (!formCall(formMapHas, removedIds, [id], "Map.has")) formListSet(retained, retained.length, id);
    }
    if (retained.length) formSetAttribute(field, "aria-describedby", formJoinTokens(retained));
    else formRemoveAttribute(field, "aria-describedby");
  }
  return null;
}

export function clearErrors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const seen = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!seen) throw new TypeError("The browser Map API is unavailable");
  const names = new __velarListNativeArray();
  for (let index = 0; index < nodes.length; index += 1) {
    const name = formText(formGetAttribute(nodes[index], "data-velar-field-error") ?? "", "Form error field name");
    if (!name || formCall(formMapHas, seen, [name], "Map.has")) continue;
    formCall(formMapSet, seen, [name, true], "Map.set");
    formListSet(names, names.length, name);
  }
  for (let index = 0; index < names.length; index += 1) clearError(form, names[index]);
  return null;
}

export function errors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const output = typeof NativeFormMap === "function" ? new NativeFormMap() : null;
  if (!output) throw new TypeError("The browser Map API is unavailable");
  for (let index = 0; index < nodes.length; index += 1) {
    const item = nodes[index];
    const name = formText(formGetAttribute(item, "data-velar-field-error") ?? "", "Form error field name");
    const message = formText(formHostRead(formNodeTextContent, NativeFormNode, item, "textContent") ?? "", "Form error message", 65536);
    if (name) formCall(formMapSet, output, [name, message], "Map.set");
  }
  return output;
}

export function focusFirstError(form) {
  requireForm(form);
  const error = formHostMethod(formElementQuerySelector, formElementOwner, form, ["[data-velar-field-error]"], "querySelector");
  const field = error ? namedField(form, formText(formGetAttribute(error, "data-velar-field-error") ?? "", "Form error field name")) : null;
  if (!field) return false;
  formHostMethod(formHtmlFocus, formHtmlOwner, field, [], "focus");
  return true;
}

export function setPending(form, pending) {
  requireForm(form);
  if (typeof pending !== "boolean") throw new TypeError("setPending requires a boolean");
  if (!pendingFields) throw new TypeError("The browser WeakMap API is unavailable");
  if (pending) {
    const elements = formElements(form);
    const snapshot = new __velarListNativeArray();
    for (let index = 0; index < elements.length; index += 1) {
      const field = elements[index];
      if (!field || typeof field !== "object") throw new TypeError("Form controls must expose a bool disabled state");
      const disabled = formControlRead(field, "disabled");
      if (typeof disabled !== "boolean") throw new TypeError("Form controls must expose a bool disabled state");
      const pair = new __velarListNativeArray(2);
      formListSet(pair, 0, field);
      formListSet(pair, 1, disabled);
      formListSet(snapshot, snapshot.length, pair);
    }
    if (!formCall(formWeakMapHas, pendingFields, [form], "WeakMap.has")) formCall(formWeakMapSet, pendingFields, [form, snapshot], "WeakMap.set");
    formSetAttribute(form, "aria-busy", "true");
    for (let index = 0; index < snapshot.length; index += 1) formControlWrite(snapshot[index][0], "disabled", true);
  } else {
    formRemoveAttribute(form, "aria-busy");
    const snapshot = formCall(formWeakMapGet, pendingFields, [form], "WeakMap.get") ?? new __velarListNativeArray();
    for (let index = 0; index < snapshot.length; index += 1) formControlWrite(snapshot[index][0], "disabled", snapshot[index][1]);
    formCall(formWeakMapDelete, pendingFields, [form], "WeakMap.delete");
  }
  return null;
}

export function reset(form) {
  requireForm(form);
  if (!pendingFields) throw new TypeError("The browser WeakMap API is unavailable");
  if (formCall(formWeakMapHas, pendingFields, [form], "WeakMap.has")) setPending(form, false);
  clearErrors(form);
  formHostMethod(formNativeReset, NativeFormElement, form, [], "reset");
  return null;
}

function namedField(form, name) {
  const elements = formElements(form);
  for (let index = 0; index < elements.length; index += 1) if (formControlRead(elements[index], "name") === name) return elements[index];
  return null;
}

function firstValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const data = formData(form);
  return formValue(formCall(formDataGet, data, [name], "FormData.get"), "Form field '" + name + "'");
}

function requireForm(value) {
  let accepted = false;
  if (typeof NativeFormElement === "function" && typeof formHasInstance === "function" && typeof formReflectApply === "function") {
    try { accepted = formReflectApply(formHasInstance, NativeFormElement, [value]); } catch {}
  }
  if (!accepted) throw new TypeError("VelarScript form helpers require a form element");
}
`.trimStart()],
  ["velar/http", String.raw`
${listRuntime}
${optionsRuntime}
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_UTF8_RUNTIME}
${runtimeTypeRuntime}
${fileRegistryRuntime}
const formBodies = new WeakMap();
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch : null;
const NativeHeaders = typeof globalThis.Headers === "function" ? globalThis.Headers : null;
const NativeResponse = typeof globalThis.Response === "function" ? globalThis.Response : null;
const NativeAbortController = typeof globalThis.AbortController === "function" ? globalThis.AbortController : null;
const NativeFormData = typeof globalThis.FormData === "function" ? globalThis.FormData : null;
const NativeBlob = typeof globalThis.Blob === "function" ? globalThis.Blob : null;
const NativeTextDecoder = typeof globalThis.TextDecoder === "function" ? globalThis.TextDecoder : null;
const NativeUint8Array = typeof globalThis.Uint8Array === "function" ? globalThis.Uint8Array : null;
const NativeMap = typeof globalThis.Map === "function" ? globalThis.Map : null;
const nativeReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const nativeMapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const nativeMapGet = Object.getOwnPropertyDescriptor(Map.prototype, "get")?.value;
const nativeMapHas = Object.getOwnPropertyDescriptor(Map.prototype, "has")?.value;
const nativeMapSet = Object.getOwnPropertyDescriptor(Map.prototype, "set")?.value;
const nativeMapForEach = Object.getOwnPropertyDescriptor(Map.prototype, "forEach")?.value;
const nativeWeakMapGet = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get")?.value;
const nativeWeakMapSet = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set")?.value;
const nativeHeadersSet = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "set")?.value : null;
const nativeHeadersHas = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "has")?.value : null;
const nativeHeadersForEach = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "forEach")?.value : null;
const nativeResponseOk = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "ok")?.get : null;
const nativeResponseStatus = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "status")?.get : null;
const nativeResponseStatusText = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "statusText")?.get : null;
const nativeResponseUrl = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "url")?.get : null;
const nativeResponseHeaders = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "headers")?.get : null;
const nativeResponseBody = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")?.get : null;
const nativeAbort = typeof NativeAbortController === "function" ? Object.getOwnPropertyDescriptor(NativeAbortController.prototype, "abort")?.value : null;
const nativeAbortSignal = typeof NativeAbortController === "function" ? Object.getOwnPropertyDescriptor(NativeAbortController.prototype, "signal")?.get : null;
const nativeFormAppend = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "append")?.value : null;
const nativeFormDelete = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "delete")?.value : null;
const nativeFormHas = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "has")?.value : null;
const nativeFormGetAll = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "getAll")?.value : null;
const nativeFormForEach = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "forEach")?.value : null;
const nativeTextDecode = typeof NativeTextDecoder === "function" ? Object.getOwnPropertyDescriptor(NativeTextDecoder.prototype, "decode")?.value : null;
const nativeSetTimeout = typeof globalThis.setTimeout === "function" ? globalThis.setTimeout : null;
const nativeClearTimeout = typeof globalThis.clearTimeout === "function" ? globalThis.clearTimeout : null;
const nativeStreamGetReader = typeof ReadableStream === "function" ? Object.getOwnPropertyDescriptor(ReadableStream.prototype, "getReader")?.value : null;
const nativeStreamCancel = typeof ReadableStream === "function" ? Object.getOwnPropertyDescriptor(ReadableStream.prototype, "cancel")?.value : null;
const nativeReaderRead = typeof ReadableStreamDefaultReader === "function" ? Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "read")?.value : null;
const nativeReaderCancel = typeof ReadableStreamDefaultReader === "function" ? Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "cancel")?.value : null;
const nativeTypedArrayPrototype = typeof NativeUint8Array === "function" ? Object.getPrototypeOf(NativeUint8Array.prototype) : null;
const nativeTypedArrayTag = nativeTypedArrayPrototype ? Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, Symbol.toStringTag)?.get : null;
const nativeTypedArrayByteLength = nativeTypedArrayPrototype ? Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, "byteLength")?.get : null;
const nativeUint8ArraySet = Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, "set")?.value;

function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }

function requireHttpHost() {
  if (typeof nativeFetch !== "function" || typeof NativeHeaders !== "function" || typeof NativeResponse !== "function"
    || typeof NativeAbortController !== "function" || typeof NativeFormData !== "function" || typeof NativeBlob !== "function"
    || typeof NativeTextDecoder !== "function" || typeof NativeUint8Array !== "function" || typeof NativeMap !== "function"
    || typeof nativeReflectApply !== "function" || typeof nativeMapSize !== "function" || typeof nativeMapGet !== "function"
    || typeof nativeMapHas !== "function" || typeof nativeMapSet !== "function" || typeof nativeMapForEach !== "function"
    || typeof nativeWeakMapGet !== "function" || typeof nativeWeakMapSet !== "function" || typeof nativeHeadersSet !== "function"
    || typeof nativeHeadersHas !== "function" || typeof nativeHeadersForEach !== "function" || typeof nativeResponseOk !== "function"
    || typeof nativeResponseStatus !== "function" || typeof nativeResponseStatusText !== "function" || typeof nativeResponseUrl !== "function"
    || typeof nativeResponseHeaders !== "function" || typeof nativeResponseBody !== "function" || typeof nativeAbort !== "function"
    || typeof nativeAbortSignal !== "function"
    || typeof nativeFormAppend !== "function" || typeof nativeFormDelete !== "function" || typeof nativeFormHas !== "function"
    || typeof nativeFormGetAll !== "function" || typeof nativeFormForEach !== "function" || typeof nativeTextDecode !== "function"
    || typeof nativeSetTimeout !== "function" || typeof nativeClearTimeout !== "function") {
    throw new TypeError("The Web HTTP host ABI is unavailable");
  }
}

function headerMap(value) {
  requireHttpHost();
  const output = new NativeHeaders();
  nativeReflectApply(nativeMapForEach, value, [(item, name) => nativeReflectApply(nativeHeadersSet, output, [name, item])]);
  return output;
}

function methodOf(value) {
  const method = __velarString(value, "HTTP method").toUpperCase();
  if (method.length > 32) throw new RangeError("HTTP methods cannot exceed 32 characters");
  if (!/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) throw new TypeError("HTTP method is invalid or forbidden by Fetch");
  return method;
}

function headersOf(value) {
  if (value == null) { requireHttpHost(); return new NativeMap(); }
  try { requireHttpHost(); nativeReflectApply(nativeMapSize, value, []); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  const headers = new NativeMap();
  let units = 0;
  nativeReflectApply(nativeMapForEach, value, [(item, name) => {
    if (typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += name.length + item.length;
    if ((!nativeReflectApply(nativeMapHas, headers, [name]) && nativeReflectApply(nativeMapSize, headers, []) >= 100) || units > 65536) throw new RangeError("HTTP headers cannot exceed 100 fields or 64 KiB");
    nativeReflectApply(nativeMapSet, headers, [name, item]);
  }]);
  return headers;
}

function responseHeadersOf(value) {
  requireHttpHost();
  const headers = new NativeMap();
  let units = 0;
  try {
    nativeReflectApply(nativeHeadersForEach, value, [(item, name) => {
      if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP response header names and values must be strings");
      units += name.length + item.length;
      if ((!nativeReflectApply(nativeMapHas, headers, [name]) && nativeReflectApply(nativeMapSize, headers, []) >= 100) || units > 65536) throw new RangeError("HTTP response headers cannot exceed 100 fields or 64 KiB");
      nativeReflectApply(nativeMapSet, headers, [name, item]);
    }]);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new TypeError("HTTP responses require native Headers");
  }
  return headers;
}

async function responseSnapshot(response) {
  let body = null;
  try {
    requireHttpHost();
    const ok = nativeReflectApply(nativeResponseOk, response, []);
    const status = nativeReflectApply(nativeResponseStatus, response, []);
    const statusText = __velarString(nativeReflectApply(nativeResponseStatusText, response, []), "HTTP response status text");
    const url = __velarString(nativeReflectApply(nativeResponseUrl, response, []), "HTTP response URL");
    const nativeHeaders = nativeReflectApply(nativeResponseHeaders, response, []);
    body = nativeReflectApply(nativeResponseBody, response, []);
    if (typeof ok !== "boolean" || !Number.isInteger(status) || status < 100 || status > 599
      || ok !== (status >= 200 && status <= 299)) {
      throw new TypeError("Fetch returned invalid HTTP response metadata");
    }
    if (statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
    return {ok, status, statusText, url, headers: responseHeadersOf(nativeHeaders), body};
  } catch (error) {
    if (body !== null && typeof nativeStreamCancel === "function") {
      try { await nativeReflectApply(nativeStreamCancel, body, [error]); } catch {}
    }
    throw error;
  }
}

function optionsOf(value) {
  value = __velarOptions(value, "HTTP options", __velarOptionFields(["headers", "body", "timeout", "maxBytes", "credentials", "cache"]));
  const timeout = value.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = value.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const credentials = value.credentials == null ? undefined : __velarString(value.credentials, "HTTP credentials");
  if (credentials !== undefined && !["omit", "same-origin", "include"].includes(credentials)) throw new TypeError("HTTP credentials must be omit, same-origin, or include");
  const cache = value.cache == null ? undefined : __velarString(value.cache, "HTTP cache mode");
  if (cache !== undefined && !["default", "no-store", "reload", "no-cache", "force-cache"].includes(cache)) throw new TypeError("HTTP cache mode must be default, no-store, reload, no-cache, or force-cache");
  let headers = headersOf(value.headers);
  let body = value.body ?? null;
  const multipart = body && typeof body === "object" ? nativeReflectApply(nativeWeakMapGet, formBodies, [body]) : null;
  const nativeForm = typeof NativeFormData === "function" && body instanceof NativeFormData;
  const nativeBlob = typeof NativeBlob === "function" && body instanceof NativeBlob;
  if (body != null && typeof body !== "string" && !multipart && !nativeForm && !nativeBlob) {
    if (typeof body !== "object") throw new TypeError("HTTP body must be text, JSON data, a Blob, or a VelarScript form body");
    body = __velarJsonStringify(body);
    let hasContentType = false;
    nativeReflectApply(nativeMapForEach, headers, [(_item, name) => { if (name.toLowerCase() === "content-type") hasContentType = true; }]);
    if (!hasContentType) nativeReflectApply(nativeMapSet, headers, ["content-type", "application/json"]);
    headers = headersOf(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > 16 * 1024 * 1024) throw new RangeError("HTTP body cannot exceed 16 MiB");
  return __velarFreezeOptionsValue({ headers, body, timeout, maxBytes, credentials, cache });
}

function fieldName(value) {
  const name = __velarString(value, "Form body field name");
  if (!name) throw new TypeError("Form body field names cannot be empty");
  if (name.length > 1024) throw new RangeError("Form body field names cannot exceed 1024 characters");
  return name;
}

function nativeFile(value) {
  return __velarNativeFile(value, "Form body files must come from velar/files pick()");
}

export function formBody() {
  requireHttpHost();
  const data = new NativeFormData();
  let fieldCount = 0;
  const reserve = (count = 1) => { if (fieldCount + count > 100000) throw new RangeError("Form bodies cannot exceed 100000 fields"); fieldCount += count; };
  const fieldValue = (value) => { value = __velarString(value, "Form body field value"); if (__velarUtf8ByteLength(value) > 16 * 1024 * 1024) throw new RangeError("Form body field values cannot exceed 16 MiB"); return value; };
  const body = {
    field(name, value) { name = fieldName(name); value = fieldValue(value); reserve(); nativeReflectApply(nativeFormAppend, data, [name, value]); return null; },
    file(name, value, fileName = "") {
      const file = nativeFile(value);
      fileName = __velarString(fileName, "Form body file name");
      if (fileName.length > 4096) throw new RangeError("Form body file names cannot exceed 4096 characters");
      name = fieldName(name);
      reserve();
      if (fileName) nativeReflectApply(nativeFormAppend, data, [name, file, fileName]);
      else nativeReflectApply(nativeFormAppend, data, [name, file]);
      return null;
    },
    files(name, values) {
      name = fieldName(name);
      const input = __velarRequireList(values, "Form body files");
      const files = new __velarListNativeArray(input.length);
      for (let index = 0; index < input.length; index += 1) {
        __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [files, index, {
          value: nativeFile(input[index]), enumerable: true, configurable: true, writable: true,
        }]);
      }
      reserve(files.length);
      for (let index = 0; index < files.length; index += 1) nativeReflectApply(nativeFormAppend, data, [name, files[index]]);
      return null;
    },
    remove(name) { name = fieldName(name); fieldCount -= nativeReflectApply(nativeFormGetAll, data, [name]).length; nativeReflectApply(nativeFormDelete, data, [name]); return null; },
    has(name) { return nativeReflectApply(nativeFormHas, data, [fieldName(name)]); },
    names() {
      const names = new __velarListNativeArray();
      const seen = new NativeMap();
      nativeReflectApply(nativeFormForEach, data, [(_value, name) => {
        if (nativeReflectApply(nativeMapHas, seen, [name])) return;
        const index = nativeReflectApply(nativeMapSize, seen, []);
        nativeReflectApply(nativeMapSet, seen, [name, true]);
        __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [names, index, {
          value: name, enumerable: true, configurable: true, writable: true,
        }]);
      }]);
      return names;
    },
  };
  nativeReflectApply(nativeWeakMapSet, formBodies, [body, data]);
  return __velarFreezeOptionsValue(body);
}

export class HttpError extends Error {
  constructor(message, status, url, body = null) {
    message = __velarString(message, "HTTP error message");
    url = __velarString(url, "HTTP error URL");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError";
    this.reason = reason;
  }
}

export const HttpTransportPhase = __velarFreezeOptionsValue({request: "request", response: "response"});
export class HttpTransportError extends Error {
  constructor(message, phase) {
    message = __velarString(message, "HTTP transport error message");
    if (message.length === 0 || message.length > 65536) throw new RangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new TypeError("HTTP transport phase must be request or response");
    }
    super(message);
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}

async function readHttpTransportChunk(reader) {
  try { return await nativeReflectApply(nativeReaderRead, reader, []); }
  catch { throw new HttpTransportError("HTTP response transport failed", HttpTransportPhase.response); }
}

class HttpResponse {
  constructor(response, request) {
    this.request = request;
    this.maxBytes = request.options.maxBytes;
    this.bytesValue = null;
    this.bytesPending = null;
    this.streaming = false;
    this.ok = response.ok;
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
    this.headers = response.headers;
    this.body = response.body;
    this.declaredLength = nativeReflectApply(nativeMapGet, response.headers, ["content-length"]) ?? null;
    this.contentType = nativeReflectApply(nativeMapGet, response.headers, ["content-type"]) ?? "";
    if (response.body === null) request.finish();
  }
  async bytes() {
    if (this.bytesValue) return this.bytesValue;
    if (this.bytesPending) return this.bytesPending;
    const declared = __velarDeclaredLength(this.declaredLength);
    if (this.body !== null && declared !== null && declared > this.maxBytes) {
      if (this.body !== null && typeof nativeStreamCancel === "function") {
        try { await nativeReflectApply(nativeStreamCancel, this.body, ["VelarScript HTTP response exceeded maxBytes"]); } catch {}
      }
      this.request.finish();
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    this.bytesPending = (async () => {
      if (this.body === null) return new NativeUint8Array();
      let reader = null;
      try {
        if (typeof nativeStreamGetReader !== "function" || typeof nativeReaderRead !== "function" || typeof nativeReaderCancel !== "function"
          || typeof nativeTypedArrayTag !== "function" || typeof nativeTypedArrayByteLength !== "function" || typeof nativeUint8ArraySet !== "function") {
          throw new TypeError("The browser does not expose the required native response stream API");
        }
        try { reader = nativeReflectApply(nativeStreamGetReader, this.body, []); }
        catch { throw new TypeError("Fetch returned an invalid HTTP response body"); }
        const chunks = new __velarListNativeArray();
        let total = 0;
        while (true) {
          const next = await readHttpTransportChunk(reader);
          if (next.done) break;
          let kind;
          let length;
          try {
            kind = nativeReflectApply(nativeTypedArrayTag, next.value, []);
            length = nativeReflectApply(nativeTypedArrayByteLength, next.value, []);
          } catch { throw new TypeError("Fetch returned a non-byte response chunk"); }
          if (kind !== "Uint8Array") throw new TypeError("Fetch returned a non-byte response chunk");
          total += length;
          if (total > this.maxBytes) throw new RangeError("HTTP response exceeds maxBytes");
          if (chunks.length >= 1000000) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
          const chunk = new NativeUint8Array(length);
          nativeReflectApply(nativeUint8ArraySet, chunk, [next.value]);
          __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [chunks, chunks.length, {
            value: chunk, enumerable: true, configurable: true, writable: true,
          }]);
        }
        const output = new NativeUint8Array(total);
        let offset = 0;
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          nativeReflectApply(nativeUint8ArraySet, output, [chunk, offset]);
          offset += nativeReflectApply(nativeTypedArrayByteLength, chunk, []);
        }
        return output;
      } catch (error) {
        if (reader !== null) {
          try { await nativeReflectApply(nativeReaderCancel, reader, [error]); } catch {}
        } else if (typeof nativeStreamCancel === "function") {
          try { await nativeReflectApply(nativeStreamCancel, this.body, [error]); } catch {}
        }
        throw error;
      }
    })();
    try { this.bytesValue = await this.bytesPending; return this.bytesValue; }
    catch (error) { if (this.request.abortError) throw this.request.abortError; throw error; }
    finally { this.bytesPending = null; this.request.finish(); }
  }
  async json() { return __velarJsonParse(await this.text(), "HTTP JSON text"); }
  async text() { const decoder = new NativeTextDecoder("utf-8", { fatal: true }); return nativeReflectApply(nativeTextDecode, decoder, [await this.bytes()]); }
  async streamText(consume) {
    if (typeof consume !== "function") throw new TypeError("HTTP streamText requires an async consumer");
    if (this.bytesValue) {
      const decoder = new NativeTextDecoder("utf-8", { fatal: true });
      const result = await consume(nativeReflectApply(nativeTextDecode, decoder, [this.bytesValue]));
      if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.bytesPending || this.streaming) throw new Error("HTTP response body is already being consumed");
    if (this.body === null) return null;
    const declared = __velarDeclaredLength(this.declaredLength);
    if (declared !== null && declared > this.maxBytes) {
      if (typeof nativeStreamCancel === "function") {
        try { await nativeReflectApply(nativeStreamCancel, this.body, ["VelarScript HTTP response exceeded maxBytes"]); } catch {}
      }
      this.request.finish();
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    if (typeof nativeStreamGetReader !== "function" || typeof nativeReaderRead !== "function" || typeof nativeReaderCancel !== "function"
      || typeof nativeTypedArrayTag !== "function" || typeof nativeTypedArrayByteLength !== "function") {
      this.request.finish();
      throw new TypeError("The browser does not expose the required native response stream API");
    }
    this.streaming = true;
    let reader;
    try { reader = nativeReflectApply(nativeStreamGetReader, this.body, []); }
    catch { this.request.finish(); throw new TypeError("Fetch returned an invalid HTTP response body"); }
    const decoder = new NativeTextDecoder("utf-8", { fatal: true });
    let total = 0;
    let chunks = 0;
    try {
      while (true) {
        const next = await readHttpTransportChunk(reader);
        if (next.done) break;
        let kind;
        let length;
        try { kind = nativeReflectApply(nativeTypedArrayTag, next.value, []); length = nativeReflectApply(nativeTypedArrayByteLength, next.value, []); }
        catch { throw new TypeError("Fetch returned a non-byte response chunk"); }
        if (kind !== "Uint8Array") throw new TypeError("Fetch returned a non-byte response chunk");
        total += length;
        chunks += 1;
        if (total > this.maxBytes || chunks > 1000000) {
          try { await nativeReflectApply(nativeReaderCancel, reader, ["VelarScript HTTP response exceeded its bound"]); } catch {}
          throw new RangeError(total > this.maxBytes ? "HTTP response exceeds maxBytes" : "HTTP responses cannot exceed 1000000 chunks");
        }
        const text = nativeReflectApply(nativeTextDecode, decoder, [next.value, { stream: true }]);
        if (text) {
          const result = await consume(text);
          if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
        }
        if (this.request.abortError) throw this.request.abortError;
      }
      const tail = nativeReflectApply(nativeTextDecode, decoder, []);
      if (tail) {
        const result = await consume(tail);
        if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      try { await nativeReflectApply(nativeReaderCancel, reader, [error]); } catch {}
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async blob() { return new NativeBlob([await this.bytes()], { type: this.contentType }); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}

class Request {
  constructor(method, url, options) {
    this.method = methodOf(method);
    this.url = __velarString(url, "HTTP URL");
    if (this.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP URLs cannot exceed 2 MiB");
    this.options = optionsOf(options);
    if ((this.method === "GET" || this.method === "HEAD") && this.options.body != null) throw new TypeError(this.method + " requests cannot have a body");
    this.controller = null;
    this.pending = null;
    this.abortError = null;
    this.finished = false;
    this.timer = null;
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    requireHttpHost();
    this.controller = new NativeAbortController();
    const timeoutMs = this.options.timeout;
    this.timer = timeoutMs ? nativeReflectApply(nativeSetTimeout, globalThis, [() => this.abort("timeout"), timeoutMs]) : null;
    this.pending = this.perform(this.controller);
    return this.pending;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
  }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
    if (this.controller) nativeReflectApply(nativeAbort, this.controller, [this.abortError]);
  }
  async perform(controller) {
    try {
      const headers = headerMap(this.options.headers);
      let body = this.options.body;
      const multipart = body != null && typeof body === "object" ? nativeReflectApply(nativeWeakMapGet, formBodies, [body]) : null;
      if (multipart instanceof NativeFormData) {
        if (nativeReflectApply(nativeHeadersHas, headers, ["content-type"])) throw new TypeError("Do not set content-type for a VelarScript form body; the browser owns its multipart boundary");
        body = multipart;
      }
      const signal = nativeReflectApply(nativeAbortSignal, controller, []);
      let transportResponse;
      try {
        transportResponse = await nativeReflectApply(nativeFetch, globalThis, [this.url, {
          method: this.method,
          headers,
          body,
          credentials: this.options.credentials,
          cache: this.options.cache,
          signal,
        }]);
      } catch {
        if (this.abortError) throw this.abortError;
        throw new HttpTransportError("HTTP request transport failed", HttpTransportPhase.request);
      }
      const response = await responseSnapshot(transportResponse);
      if (this.abortError) throw this.abortError;
      const wrapped = new HttpResponse(response, this);
      if (!wrapped.ok) {
        const text = await wrapped.text();
        let parsed = text;
        try { parsed = text ? __velarJsonParse(text, "HTTP error JSON text") : null; } catch { parsed = text; }
        const errorUrl = wrapped.url || this.url;
        throw new HttpError("HTTP " + wrapped.status + " for " + errorUrl, wrapped.status, errorUrl, parsed);
      }
      return wrapped;
    } catch (error) {
      this.finish();
      if (this.abortError) throw this.abortError;
      throw error;
    }
  }
  async json() { return (await this.response()).json(); }
  async text() { return (await this.response()).text(); }
  async streamText(consume) { return (await this.response()).streamText(consume); }
  async blob() { return (await this.response()).blob(); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}

const createRequest = (method) => (url, options = {}) => new Request(method, url, options);
export const http = __velarFreezeOptionsValue({
  request(method, url, options = {}) { return new Request(method, url, options); },
  get: createRequest("GET"), post: createRequest("POST"), put: createRequest("PUT"), patch: createRequest("PATCH"), delete: createRequest("DELETE"), head: createRequest("HEAD"),
});
`.trimStart()],
  ["velar/storage", String.raw`
${ownedCallbackRuntime}
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_UTF8_RUNTIME}
${listRuntime}
${runtimeTypeRuntime}
${storageHostRuntime}
const changeEvent = "velar-storage-change";
const storageMaxKeyCodeUnits = 4096;
const storageMaxListingCodeUnits = 16 * 1024 * 1024;
const storageMaxValueBytes = 16 * 1024 * 1024;
const storageNumberIsSafeInteger = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")?.value;
const storageStringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice").value;
const storageListSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort").value;
const storageMissingField = __velarBrowserMissingField;

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
  try { return Type.parse(__velarJsonParse(raw, "Stored JSON text")); } catch { return fallback; }
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
        storageListen(request, "error", guarded(() => reject(requestError(request))), { once: true });
        storageListen(request, "blocked", () => reject(new Error("VelarScript database upgrade is blocked by another open page")), { once: true });
      } catch (error) { reject(error); }
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
        reject(error);
        return;
      }
      let value;
      let settled = false;
      const fail = (error) => { if (!settled) { settled = true; reject(error); } };
      const guarded = (callback) => (...arguments_) => { try { callback(...arguments_); } catch (error) { fail(error); } };
      try {
        const store = storageHostCall(transaction, "objectStore", storageIdbTransactionObjectStore, storageNativeIdbTransaction, ["values"]);
        const result = operation(store);
        storageListen(result, "success", guarded(() => { value = requestResult(result); }), { once: true });
        storageListen(result, "error", guarded(() => fail(requestError(result))), { once: true });
        storageListen(transaction, "abort", guarded(() => fail(storageHostField(transaction, "error", storageIdbTransactionError, storageNativeIdbTransaction))), { once: true });
        storageListen(transaction, "error", guarded(() => fail(storageHostField(transaction, "error", storageIdbTransactionError, storageNativeIdbTransaction))), { once: true });
        storageListen(transaction, "complete", guarded(() => { if (!settled) { settled = true; resolve(value); } }), { once: true });
      } catch (error) {
        try { storageHostCall(transaction, "abort", storageIdbTransactionAbort, storageNativeIdbTransaction); } catch {}
        fail(error);
      }
    });
  };
  const keyOf = (key) => storageText(key, "Database key");
  return Object.freeze({
    async get(key, Type, fallback = null, maxBytes = storageMaxValueBytes) { Type = storageType(Type); maxBytes = storageByteBudget(maxBytes); const name = keyOf(key); const encoded = await request("readonly", (store) => objectOperation(store, "get", [name])); if (encoded === undefined || typeof encoded !== "string" || __velarUtf8ByteLength(encoded) > maxBytes) return fallback; try { return Type.parse(__velarJsonParse(encoded, "Stored JSON text")); } catch { return fallback; } },
    async set(key, value, maxBytes = storageMaxValueBytes) {
      const name = keyOf(key);
      maxBytes = storageByteBudget(maxBytes);
      const encoded = __velarJsonStringify(value);
      if (__velarUtf8ByteLength(encoded) > maxBytes) throw new RangeError("Stored JSON exceeds maxBytes");
      await request("readwrite", (store) => objectOperation(store, "put", [encoded, name]));
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
`.trimStart()],
  ["velar/browser", String.raw`
${VELAR_TEXT_METHOD_RUNTIME}
${ownedCallbackRuntime}
${optionsRuntime}
${browserHostRuntime}
const timerRuntimeKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});
const browserMediaEventConstructor = __velarBrowserConstructor("MediaQueryListEvent");
const browserMediaEventMatches = __velarBrowserPrototypeMember(browserMediaEventConstructor, "matches", "get");
function browserMediaEventField(event) {
  return __velarBrowserField(event, "matches", browserMediaEventMatches, browserMediaEventConstructor);
}

function browserNumber(value, name) { if (!Number.isFinite(value)) throw new TypeError(name + " must be a finite number"); return value; }
function browserBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
function browserText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function browserQuery(search) {
  search = browserText(search, "Browser location query", 2 * 1024 * 1024);
  if (typeof __velarBrowserUrlSearchParamsConstructor !== "function" || typeof __velarBrowserUrlSearchParamsForEach !== "function") {
    throw new TypeError("The browser URLSearchParams API is unavailable");
  }
  const output = new Map();
  let count = 0;
  const params = new __velarBrowserUrlSearchParamsConstructor(search);
  __velarBrowserCallCaptured(__velarBrowserUrlSearchParamsForEach, params, [(value, name) => {
    count += 1;
    if (count > 100000) throw new RangeError("Browser location queries cannot exceed 100000 fields");
    output.set(name, value);
  }], "URLSearchParams.forEach");
  return output;
}
function browserLanguages(value) {
  if (!Array.isArray(value) || value.length > 1000 || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) throw new TypeError("Browser languages must be a dense List");
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Browser languages cannot use accessors");
    output[index] = browserText(descriptor.value, "Browser language", 256);
  }
  return output;
}
function scrollBehavior(value) { value = __velarString(value, "Scroll behavior"); if (!["auto", "smooth", "instant"].includes(value)) throw new TypeError("Scroll behavior must be auto, smooth, or instant"); return value; }

function timerDuration(value, name, positive) {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647 || (positive && value === 0)) {
    throw new RangeError(name + (positive ? " requires milliseconds from above 0 through 2147483647" : " requires milliseconds from 0 through 2147483647"));
  }
  return value;
}

function reportTimerFailure(failure, detail) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[timerRuntimeKey];
  if (runtime && typeof runtime.report === "function") {
    runtime.report(error, { phase: "timer", detail, unhandled: true });
  } else {
    __velarBrowserCallCaptured(__velarBrowserQueueMicrotask, __velarBrowserWindow, [() => { throw error; }], "queueMicrotask");
  }
}

async function invokeTimer(callback, detail) {
  try {
    const observed = __velarObservePromise(
      callback(),
      (failure) => __velarReportOwnedCallback(failure, "timer", detail),
    );
    if (observed) await observed;
  }
  catch (error) { reportTimerFailure(error, detail); }
}

export function after(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "after", false);
  if (typeof callback !== "function") throw new TypeError("after requires a callback");
  let active = true;
  const timer = __velarBrowserCallCaptured(__velarBrowserSetTimeout, __velarBrowserWindow, [() => {
    if (!active) return;
    active = false;
    void invokeTimer(callback, "after");
  }, duration], "setTimeout");
  return () => { active = false; __velarBrowserCallCaptured(__velarBrowserClearTimeout, __velarBrowserWindow, [timer], "clearTimeout"); return null; };
}

export function every(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "every", true);
  if (typeof callback !== "function") throw new TypeError("every requires a callback");
  let active = true;
  let timer = null;
  const schedule = () => {
    if (!active) return;
    timer = __velarBrowserCallCaptured(__velarBrowserSetTimeout, __velarBrowserWindow, [async () => {
      if (!active) return;
      await invokeTimer(callback, "every");
      schedule();
    }, duration], "setTimeout");
  };
  schedule();
  return () => { active = false; if (timer !== null) __velarBrowserCallCaptured(__velarBrowserClearTimeout, __velarBrowserWindow, [timer], "clearTimeout"); return null; };
}

export function location() {
  const value = __velarBrowserLocation;
  return Object.freeze({
    href: browserText(__velarBrowserField(value, "href", __velarBrowserLocationHref, __velarBrowserLocationConstructor), "Browser location URL", 2 * 1024 * 1024),
    origin: browserText(__velarBrowserField(value, "origin", __velarBrowserLocationOrigin, __velarBrowserLocationConstructor), "Browser location origin", 2 * 1024 * 1024),
    path: browserText(__velarBrowserField(value, "pathname", __velarBrowserLocationPathname, __velarBrowserLocationConstructor), "Browser location path", 2 * 1024 * 1024),
    query: browserQuery(__velarBrowserField(value, "search", __velarBrowserLocationSearch, __velarBrowserLocationConstructor)),
    hash: browserText(__velarBrowserField(value, "hash", __velarBrowserLocationHash, __velarBrowserLocationConstructor), "Browser location hash", 2 * 1024 * 1024),
  });
}

export function environment() {
  const navigatorValue = __velarBrowserNavigator;
  const language = browserText(__velarBrowserField(navigatorValue, "language", __velarBrowserNavigatorLanguage, __velarBrowserNavigatorConstructor), "Browser language", 256);
  const languages = browserLanguages(__velarBrowserField(navigatorValue, "languages", __velarBrowserNavigatorLanguages, __velarBrowserNavigatorConstructor));
  const online = __velarBrowserField(navigatorValue, "onLine", __velarBrowserNavigatorOnline, __velarBrowserNavigatorConstructor);
  const touchPoints = __velarBrowserField(navigatorValue, "maxTouchPoints", __velarBrowserNavigatorTouchPoints, __velarBrowserNavigatorConstructor);
  if (typeof online !== "boolean") throw new TypeError("Browser online state must be bool");
  const visibility = __velarBrowserField(__velarBrowserDocument, "visibilityState", __velarBrowserDocumentVisibility, __velarBrowserDocumentConstructor);
  if (visibility !== "visible" && visibility !== "hidden") throw new TypeError("Browser visibility state is invalid");
  const darkMatcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, ["(prefers-color-scheme: dark)"], "matchMedia");
  const reducedMatcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, ["(prefers-reduced-motion: reduce)"], "matchMedia");
  const dark = __velarBrowserField(darkMatcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor);
  const reduced = __velarBrowserField(reducedMatcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor);
  if (typeof dark !== "boolean" || typeof reduced !== "boolean") throw new TypeError("Browser media preferences must be bool");
  if (!Number.isSafeInteger(touchPoints) || touchPoints < 0 || touchPoints > 1000) throw new RangeError("Browser touch points are outside VelarScript limits");
  return Object.freeze({
    language,
    languages,
    online,
    visible: visibility === "visible",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reduced,
    touch: touchPoints > 0,
  });
}

function clipboard() {
  const value = __velarBrowserClipboard;
  if (__velarBrowserSecureContext !== true || !__velarBrowserNativeInstance(value, __velarBrowserClipboardConstructor)
    || typeof __velarBrowserClipboardWrite !== "function" || typeof __velarBrowserClipboardRead !== "function") {
    throw new Error("Clipboard access requires a secure browser context");
  }
  return value;
}

export async function copyText(value) { value = browserText(value, "Clipboard text", 16 * 1024 * 1024); await __velarBrowserCallCaptured(__velarBrowserClipboardWrite, clipboard(), [value], "Clipboard.writeText"); return null; }
export async function readClipboardText() { return browserText(await __velarBrowserCallCaptured(__velarBrowserClipboardRead, clipboard(), [], "Clipboard.readText"), "Clipboard text", 16 * 1024 * 1024); }
export function open(url, target = "_blank") { url = browserText(url, "Browser URL", 2 * 1024 * 1024); target = browserText(target, "Browser target", 256); __velarBrowserCallCaptured(__velarBrowserOpen, __velarBrowserWindow, [url, target, target === "_blank" ? "noopener,noreferrer" : undefined], "open"); return null; }
export function scrollTo(x, y, behavior = "auto") { __velarBrowserCallCaptured(__velarBrowserScrollTo, __velarBrowserWindow, [{ left: browserNumber(x, "Scroll x"), top: browserNumber(y, "Scroll y"), behavior: scrollBehavior(behavior) }], "scrollTo"); return null; }
export function scrollIntoView(element, behavior = "smooth") { element = requireElement(element); __velarBrowserCallCaptured(__velarBrowserElementScrollIntoView, element, [{ behavior: scrollBehavior(behavior), block: "nearest" }], "Element.scrollIntoView"); return null; }
export function scrollMetrics(element) {
  element = requireElement(element);
  const x = browserNumber(__velarBrowserField(element, "scrollLeft", __velarBrowserElementScrollLeft, __velarBrowserElementConstructor), "Element scroll x");
  const y = browserNumber(__velarBrowserField(element, "scrollTop", __velarBrowserElementScrollTop, __velarBrowserElementConstructor), "Element scroll y");
  const viewportWidth = browserNumber(__velarBrowserField(element, "clientWidth", __velarBrowserElementClientWidth, __velarBrowserElementConstructor), "Element viewport width");
  const viewportHeight = browserNumber(__velarBrowserField(element, "clientHeight", __velarBrowserElementClientHeight, __velarBrowserElementConstructor), "Element viewport height");
  const contentWidth = browserNumber(__velarBrowserField(element, "scrollWidth", __velarBrowserElementScrollWidth, __velarBrowserElementConstructor), "Element content width");
  const contentHeight = browserNumber(__velarBrowserField(element, "scrollHeight", __velarBrowserElementScrollHeight, __velarBrowserElementConstructor), "Element content height");
  if (viewportWidth < 0 || viewportHeight < 0 || contentWidth < 0 || contentHeight < 0) throw new RangeError("Element scroll dimensions cannot be negative");
  return Object.freeze({ x, y, viewportWidth, viewportHeight, contentWidth, contentHeight });
}
export function scrollElementTo(element, x, y, behavior = "auto") {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementScrollTo, element, [{ left: browserNumber(x, "Element scroll x"), top: browserNumber(y, "Element scroll y"), behavior: scrollBehavior(behavior) }], "Element.scrollTo");
  return null;
}
function pointerId(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new RangeError("Pointer ID must be an integer from 0 through 2147483647");
  return value;
}
export function capturePointer(element, id) {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementSetPointerCapture, element, [pointerId(id)], "Element.setPointerCapture");
  return null;
}
export function releasePointer(element, id) {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementReleasePointerCapture, element, [pointerId(id)], "Element.releasePointerCapture");
  return null;
}
export function focus(element, preventScroll = false) {
  element = requireFocusableElement(element);
  preventScroll = __velarBool(preventScroll, "Focus preventScroll");
  __velarBrowserCallCaptured(__velarBrowserElementFocus, element, [{ preventScroll }], "HTMLElement.focus");
  return null;
}
export function blur(element) {
  element = requireFocusableElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementBlur, element, [], "HTMLElement.blur");
  return null;
}
export function measure(element) {
  element = requireElement(element);
  const value = __velarBrowserCallCaptured(__velarBrowserElementMeasure, element, [], "Element.getBoundingClientRect");
  return Object.freeze({
    x: browserNumber(__velarBrowserField(value, "x", __velarBrowserRectX, __velarBrowserDomRectConstructor), "Element x"),
    y: browserNumber(__velarBrowserField(value, "y", __velarBrowserRectY, __velarBrowserDomRectConstructor), "Element y"),
    width: browserNumber(__velarBrowserField(value, "width", __velarBrowserRectWidth, __velarBrowserDomRectConstructor), "Element width"),
    height: browserNumber(__velarBrowserField(value, "height", __velarBrowserRectHeight, __velarBrowserDomRectConstructor), "Element height"),
    top: browserNumber(__velarBrowserField(value, "top", __velarBrowserRectTop, __velarBrowserDomRectReadOnlyConstructor), "Element top"),
    right: browserNumber(__velarBrowserField(value, "right", __velarBrowserRectRight, __velarBrowserDomRectReadOnlyConstructor), "Element right"),
    bottom: browserNumber(__velarBrowserField(value, "bottom", __velarBrowserRectBottom, __velarBrowserDomRectReadOnlyConstructor), "Element bottom"),
    left: browserNumber(__velarBrowserField(value, "left", __velarBrowserRectLeft, __velarBrowserDomRectReadOnlyConstructor), "Element left"),
  });
}
function requireTextArea(value) {
  if (!__velarBrowserNativeInstance(value, __velarBrowserTextAreaConstructor)
    || typeof __velarBrowserTextAreaValue !== "function"
    || typeof __velarBrowserTextAreaSelectionStart !== "function"
    || typeof __velarBrowserTextAreaSelectionEnd !== "function"
    || typeof __velarBrowserTextAreaSelectionDirection !== "function"
    || typeof __velarBrowserTextAreaSetSelectionRange !== "function") {
    throw new TypeError("Text selection helpers require a <textarea> element");
  }
  return value;
}
function textAreaValue(element) {
  const value = __velarBrowserField(element, "value", __velarBrowserTextAreaValue, __velarBrowserTextAreaConstructor);
  if (typeof value !== "string" || value.length > __velarMaxTextCodeUnits) throw new TypeError("Textarea value is outside VelarScript text bounds");
  return value;
}
function selectionDirection(value) {
  if (value !== "forward" && value !== "backward" && value !== "none") throw new TypeError("Text selection direction must be forward, backward, or none");
  return value;
}
export function textSelection(element) {
  element = requireTextArea(element);
  const value = textAreaValue(element);
  const unitStart = __velarBrowserField(element, "selectionStart", __velarBrowserTextAreaSelectionStart, __velarBrowserTextAreaConstructor);
  const unitEnd = __velarBrowserField(element, "selectionEnd", __velarBrowserTextAreaSelectionEnd, __velarBrowserTextAreaConstructor);
  const direction = selectionDirection(__velarBrowserField(element, "selectionDirection", __velarBrowserTextAreaSelectionDirection, __velarBrowserTextAreaConstructor));
  if (!Number.isSafeInteger(unitStart) || !Number.isSafeInteger(unitEnd) || unitStart < 0 || unitEnd < unitStart || unitEnd > value.length) {
    throw new TypeError("Textarea selection is outside its value");
  }
  const start = __velarTextCodePointIndex(value, unitStart);
  const end = __velarTextCodePointIndex(value, unitEnd);
  if (start === null || end === null) throw new TypeError("Textarea selection cannot split a Unicode code point");
  return Object.freeze({ start, end, direction });
}
export function setTextSelection(element, start, end, direction = "none") {
  element = requireTextArea(element);
  const value = textAreaValue(element);
  const size = __velarTextCodePointLength(value);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > size) {
    throw new RangeError("Text selection must be an ordered code-point range inside the textarea value");
  }
  direction = selectionDirection(direction);
  __velarBrowserCallCaptured(__velarBrowserTextAreaSetSelectionRange, element, [
    __velarTextCodeUnitOffset(value, start),
    __velarTextCodeUnitOffset(value, end),
    direction,
  ], "HTMLTextAreaElement.setSelectionRange");
  return null;
}
function clipboardData(event) {
  if (!__velarBrowserNativeInstance(event, __velarBrowserClipboardEventConstructor)) throw new TypeError("Clipboard helpers require a ClipboardEvent");
  const data = __velarBrowserField(event, "clipboardData", __velarBrowserClipboardEventData, __velarBrowserClipboardEventConstructor);
  if (!__velarBrowserNativeInstance(data, __velarBrowserDataTransferConstructor)) throw new TypeError("ClipboardEvent does not expose native clipboard data");
  return data;
}
export function clipboardText(event) {
  const data = clipboardData(event);
  return browserText(__velarBrowserCallCaptured(__velarBrowserDataTransferGetData, data, ["text/plain"], "DataTransfer.getData"), "Clipboard event text", 16 * 1024 * 1024);
}
export function setClipboardText(event, value) {
  value = browserText(value, "Clipboard event text", 16 * 1024 * 1024);
  const data = clipboardData(event);
  __velarBrowserCallCaptured(__velarBrowserDataTransferSetData, data, ["text/plain", value], "DataTransfer.setData");
  return null;
}
export function media(query) { const matcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, [browserText(query, "Media query", 4096)], "matchMedia"); return browserBool(__velarBrowserField(matcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor), "Media query result"); }
export function watchMedia(query, callback) {
  if (typeof callback !== "function") throw new TypeError("watchMedia requires a callback");
  const matcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, [browserText(query, "Media query", 4096)], "matchMedia");
  const changed = (event) => __velarInvokeOwnedRead(() => browserBool(browserMediaEventField(event), "Media watcher result"), callback, "observer", "media");
  const remove = __velarBrowserListen(matcher, "change", changed);
  return () => { remove(); return null; };
}
export function watchOnline(callback) {
  if (typeof callback !== "function") throw new TypeError("watchOnline requires a callback");
  const changed = () => __velarInvokeOwnedRead(() => browserBool(__velarBrowserField(__velarBrowserNavigator, "onLine", __velarBrowserNavigatorOnline, __velarBrowserNavigatorConstructor), "Browser online state"), callback, "observer", "online");
  const removeOnline = __velarBrowserListenGlobal("online", changed);
  const removeOffline = __velarBrowserListenGlobal("offline", changed);
  return () => { removeOnline(); removeOffline(); return null; };
}
export function watchVisibility(callback) {
  if (typeof callback !== "function") throw new TypeError("watchVisibility requires a callback");
  const changed = () => __velarInvokeOwnedRead(() => {
    const visibility = __velarBrowserField(__velarBrowserDocument, "visibilityState", __velarBrowserDocumentVisibility, __velarBrowserDocumentConstructor);
    if (visibility !== "visible" && visibility !== "hidden") throw new TypeError("Browser visibility state is invalid");
    return visibility === "visible";
  }, callback, "observer", "visibility");
  const remove = __velarBrowserListen(__velarBrowserDocument, "visibilitychange", changed);
  return () => { remove(); return null; };
}
export function showDialog(dialog) {
  requireDialog(dialog);
  const connected = __velarBrowserField(dialog, "isConnected", __velarBrowserNodeConnected, __velarBrowserNodeConstructor);
  const open = __velarBrowserField(dialog, "open", __velarBrowserDialogOpen, __velarBrowserDialogConstructor);
  if (connected !== true) throw new Error("A dialog must be mounted before it can be shown");
  if (typeof open !== "boolean") throw new TypeError("Dialog open state must be bool");
  if (!open) __velarBrowserCallCaptured(__velarBrowserDialogShowModal, dialog, [], "HTMLDialogElement.showModal");
  return null;
}
export function closeDialog(dialog, result = "") {
  requireDialog(dialog);
  result = browserText(result, "Dialog result", 65536);
  const open = __velarBrowserField(dialog, "open", __velarBrowserDialogOpen, __velarBrowserDialogConstructor);
  if (typeof open !== "boolean") throw new TypeError("Dialog open state must be bool");
  if (open) __velarBrowserCallCaptured(__velarBrowserDialogClose, dialog, [result], "HTMLDialogElement.close");
  return null;
}
export function dialogResult(dialog) { requireDialog(dialog); return browserText(__velarBrowserField(dialog, "returnValue", __velarBrowserDialogResult, __velarBrowserDialogConstructor), "Dialog result", 65536); }
export function frame() { return new Promise((resolve, reject) => __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [(value) => { try { resolve(browserNumber(value, "Animation frame timestamp")); } catch (error) { reject(error); } }], "requestAnimationFrame")); }
function requireElement(value) { if (!__velarBrowserNativeInstance(value, __velarBrowserElementConstructor)) throw new TypeError("Browser element helpers require an Element"); return value; }
function requireFocusableElement(value) {
  requireElement(value);
  if (!__velarBrowserNativeInstance(value, __velarBrowserHtmlElementConstructor)) throw new TypeError("Focus helpers require an HTML element");
  return value;
}
function requireDialog(value) {
  if (!__velarBrowserNativeInstance(value, __velarBrowserDialogConstructor)
    || typeof __velarBrowserDialogShowModal !== "function" || typeof __velarBrowserDialogClose !== "function") {
    throw new TypeError("Dialog helpers require a <dialog> element");
  }
}
`.trimStart()],
  ["velar/files", String.raw`
${optionsRuntime}
${fileRegistryRuntime}
const defaultFileReadBytes = 16 * 1024 * 1024;
const maxFileReadBytes = 64 * 1024 * 1024;
const nativeFileListLength = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "length")?.get : null;
const nativeFileListItem = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "item")?.value : null;
function readLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileReadBytes) throw new RangeError("File maxBytes must be an integer from 1 through 67108864");
  return value;
}
function fileText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function nativePickerField(operation, files, index = null) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native FileList API");
  try { return index === null ? operation.call(files) : operation.call(files, index); }
  catch { throw new TypeError("A file picker returned an invalid native FileList"); }
}
function wrap(file) {
  const name = fileText(__velarReadNativeFileField(__velarNativeFileName, file), "Selected file name", 4096);
  const type = fileText(__velarReadNativeFileField(__velarNativeBlobType, file), "Selected file MIME type", 1024);
  const size = __velarReadNativeFileField(__velarNativeBlobSize, file);
  const modified = __velarReadNativeFileField(__velarNativeFileModified, file);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Selected file size must be a non-negative safe integer");
  if (!Number.isFinite(modified) || modified < 0) throw new TypeError("Selected file modified time must be a non-negative finite number");
  const value = { name, size, type, modified };
  Object.freeze(value);
  WeakMap.prototype.set.call(nativeFiles, value, file);
  return value;
}
function native(file) { return __velarNativeFile(file, "Expected a file returned by velar/files"); }
export function pick(options = {}) {
  options = __velarOptions(options, "File picker options", __velarOptionFields(["accept", "multiple"]));
  const accept = options.accept == null ? "" : __velarString(options.accept, "File accept filter");
  if (accept.length > 4096) throw new RangeError("File accept filters cannot exceed 4096 characters");
  const multiple = options.multiple == null ? false : __velarBool(options.multiple, "File picker multiple");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      globalThis.removeEventListener("focus", focused);
      try {
        const selected = input.files;
        if (!selected || typeof selected !== "object") throw new TypeError("A file picker returned an invalid file list");
        const count = nativePickerField(nativeFileListLength, selected);
        if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("A file picker returned an invalid file list length");
        if (count > 10000) {
          input.remove();
          reject(new RangeError("A file picker cannot return more than 10000 files"));
          return;
        }
        const files = [];
        for (let index = 0; index < count; index += 1) {
          const file = nativePickerField(nativeFileListItem, selected, index);
          if (file === null) throw new TypeError("A file picker returned an incomplete native FileList");
          files.push(wrap(file));
        }
        input.remove();
        resolve(files);
      } catch (error) {
        input.remove();
        reject(error);
      }
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    const focused = () => setTimeout(finish, 0);
    globalThis.addEventListener("focus", focused, { once: true });
    input.click();
  });
}
export function readText(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  if (typeof __velarNativeBlobText !== "function") throw new TypeError("The browser does not expose native Blob text reading");
  return Promise.resolve(__velarNativeBlobText.call(value)).then((result) => {
    if (typeof result !== "string") throw new TypeError("File text result was not a string");
    if (result.length > maxBytes) throw new RangeError("File text result exceeds maxBytes");
    return result;
  });
}
export function readDataUrl(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { reject(new TypeError("File data URL result was not text")); return; }
      if (reader.result.length > Math.ceil(maxBytes * 4 / 3) + 4096) { reject(new RangeError("File data URL result exceeds maxBytes expansion")); return; }
      resolve(reader.result);
    };
    reader.onerror = () => reject(__velarIsError(reader.error) ? reader.error : new __velarErrorNativeError("File reading failed"));
    reader.readAsDataURL(value);
  });
}
export function download(name, data, mime = "text/plain;charset=utf-8") {
  name = __velarString(name, "Download name");
  data = __velarString(data, "Download data");
  mime = __velarString(mime, "Download MIME type");
  if (!name || name.length > 4096) throw new RangeError("Download names must contain 1 through 4096 characters");
  if (data.length > maxFileReadBytes) throw new RangeError("Download text cannot exceed 64 MiB");
  if (!mime || mime.length > 1024) throw new RangeError("Download MIME types must contain 1 through 1024 characters");
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}
`.trimStart()],
  ["velar/realtime", String.raw`
${ownedCallbackRuntime}
${optionsRuntime}
${VELAR_STRICT_JSON_RUNTIME}
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
const RealtimeWebSocket = realtimeGlobalConstructor("WebSocket");
const realtimeWebSocketPrototype = realtimePrototype(RealtimeWebSocket);
const realtimeWebSocketAddEventListener = realtimePrototypeMember(realtimeWebSocketPrototype, "addEventListener", "value");
const realtimeWebSocketSend = realtimePrototypeMember(realtimeWebSocketPrototype, "send", "value");
const realtimeWebSocketClose = realtimePrototypeMember(realtimeWebSocketPrototype, "close", "value");
const realtimeWebSocketUrl = realtimePrototypeMember(realtimeWebSocketPrototype, "url", "get");
const realtimeWebSocketReadyState = realtimePrototypeMember(realtimeWebSocketPrototype, "readyState", "get");
const RealtimeEventSource = realtimeGlobalConstructor("EventSource");
const realtimeEventSourcePrototype = realtimePrototype(RealtimeEventSource);
const realtimeEventSourceAddEventListener = realtimePrototypeMember(realtimeEventSourcePrototype, "addEventListener", "value");
const realtimeEventSourceClose = realtimePrototypeMember(realtimeEventSourcePrototype, "close", "value");
const realtimeEventSourceUrl = realtimePrototypeMember(realtimeEventSourcePrototype, "url", "get");
const realtimeEventSourceReadyState = realtimePrototypeMember(realtimeEventSourcePrototype, "readyState", "get");
const realtimeMessageEventPrototype = realtimePrototype(realtimeGlobalConstructor("MessageEvent"));
const realtimeMessageEventData = realtimePrototypeMember(realtimeMessageEventPrototype, "data", "get");
const realtimeMessageEventLastEventId = realtimePrototypeMember(realtimeMessageEventPrototype, "lastEventId", "get");
const realtimeCloseEventPrototype = realtimePrototype(realtimeGlobalConstructor("CloseEvent"));
const realtimeCloseEventCode = realtimePrototypeMember(realtimeCloseEventPrototype, "code", "get");
const realtimeCloseEventReason = realtimePrototypeMember(realtimeCloseEventPrototype, "reason", "get");
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
function realtimeUtf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7F) bytes += 1;
    else if (code <= 0x7FF) bytes += 2;
    else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { bytes += 4; index += 1; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
function realtimeUrl(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeUrlCodeUnits) throw new RangeError(name + " cannot exceed 2 MiB");
  return value;
}
function realtimeMessage(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
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
function webSocketState(value) {
  const readyState = realtimeHostField(value, "readyState", realtimeWebSocketReadyState);
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closing";
  if (readyState === 3) return "closed";
  throw new TypeError("WebSocket returned an invalid state");
}
function eventStreamState(value) {
  const readyState = realtimeHostField(value, "readyState", realtimeEventSourceReadyState);
  if (readyState === 0) return "connecting";
  if (readyState === 1) return "open";
  if (readyState === 2) return "closed";
  throw new TypeError("Event stream returned an invalid state");
}
export function socket(url, handlers = {}) {
  handlers = handler(handlers, __velarOptionFields(["open", "message", "error", "close"]));
  if (!RealtimeWebSocket) throw new TypeError("The browser does not expose native WebSocket");
  const value = new RealtimeWebSocket(realtimeUrl(url, "WebSocket URL"));
  let resolvedUrl;
  try {
    const hostUrl = realtimeHostField(value, "url", realtimeWebSocketUrl);
    if (hostUrl === realtimeMissingField) throw new TypeError("WebSocket returned an invalid resolved URL");
    resolvedUrl = realtimeUrl(hostUrl, "WebSocket resolved URL");
  }
  catch (failure) { try { realtimeCall(realtimeWebSocketClose, value, [], "WebSocket close"); } catch {} throw failure; }
  const opened = () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "socket:open");
  const messaged = (event) => {
    const data = realtimeHostField(event, "data", realtimeMessageEventData);
    if (data === realtimeMissingField) {
      __velarReportOwnedCallback(new TypeError("WebSocket message event is invalid"), "realtime", "socket:message");
      try {
        const state = webSocketState(value);
        if (state === "connecting" || state === "open") realtimeCall(realtimeWebSocketClose, value, [1003, "Invalid message event"], "WebSocket close");
      } catch {}
      return;
    }
    if (typeof data !== "string") {
      __velarInvokeOwnedCallback(handlers.error, ["Binary WebSocket messages are not supported by VelarScript Web API 0.10"], "realtime", "socket:error");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") realtimeCall(realtimeWebSocketClose, value, [1003, "Text messages only"], "WebSocket close");
      return;
    }
    if (data.length > maxRealtimeTextCodeUnits) {
      __velarInvokeOwnedCallback(handlers.error, ["WebSocket message exceeded 16 MiB"], "realtime", "socket:error");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") realtimeCall(realtimeWebSocketClose, value, [1009, "Message too large"], "WebSocket close");
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [data], "realtime", "socket:message");
  };
  const failed = () => __velarInvokeOwnedCallback(handlers.error, ["WebSocket connection error"], "realtime", "socket:error");
  const closed = (event) => {
    try {
      const code = realtimeHostField(event, "code", realtimeCloseEventCode);
      const hostReason = realtimeHostField(event, "reason", realtimeCloseEventReason);
      if (code === realtimeMissingField || hostReason === realtimeMissingField) throw new TypeError("WebSocket close event is invalid");
      const reason = realtimeMessage(hostReason, "WebSocket close event reason");
      if (!Number.isSafeInteger(code) || code < 0 || code > 65535) throw new TypeError("WebSocket close event returned an invalid code");
      if (reason.length > 123 || realtimeUtf8Length(reason) > 123) throw new RangeError("WebSocket close event reason cannot exceed 123 UTF-8 bytes");
      __velarInvokeOwnedCallback(handlers.close, [code, reason], "realtime", "socket:close");
    } catch (failure) { __velarReportOwnedCallback(failure, "realtime", "socket:close"); }
  };
  try {
    realtimeCall(realtimeWebSocketAddEventListener, value, ["open", opened], "WebSocket event listener");
    realtimeCall(realtimeWebSocketAddEventListener, value, ["message", messaged], "WebSocket event listener");
    realtimeCall(realtimeWebSocketAddEventListener, value, ["error", failed], "WebSocket event listener");
    realtimeCall(realtimeWebSocketAddEventListener, value, ["close", closed], "WebSocket event listener");
  } catch (failure) {
    try { realtimeCall(realtimeWebSocketClose, value, [], "WebSocket close"); } catch {}
    throw failure;
  }
  return Object.freeze({
    url: resolvedUrl,
    state: () => webSocketState(value),
    send(data) { data = realtimeMessage(data, "WebSocket message"); if (webSocketState(value) !== "open") throw new Error("WebSocket is not open"); realtimeCall(realtimeWebSocketSend, value, [data], "WebSocket send"); return null; },
    sendJson(data) { const text = __velarJsonStringify(data); if (webSocketState(value) !== "open") throw new Error("WebSocket is not open"); realtimeCall(realtimeWebSocketSend, value, [text], "WebSocket send"); return null; },
    close(code = 1000, reason = "") {
      if (!Number.isSafeInteger(code) || (code !== 1000 && (code < 3000 || code > 4999))) throw new RangeError("WebSocket close code must be 1000 or from 3000 through 4999");
      reason = __velarString(reason, "WebSocket close reason");
      if (reason.length > 123 || realtimeUtf8Length(reason) > 123) throw new RangeError("WebSocket close reason cannot exceed 123 UTF-8 bytes");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") realtimeCall(realtimeWebSocketClose, value, [code, reason], "WebSocket close");
      return null;
    },
  });
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
`.trimStart()],
  ["velar/web-test", String.raw`
const browserRuntimeKey = Symbol.for("velar.browser.test.v1");
function browserRuntime() {
  const runtime = globalThis[browserRuntimeKey];
  if (!runtime) throw new Error("velar/web-test browser controls require 'velar test --browser'");
  return runtime;
}
export const browser = Object.freeze({
  open(path = "/") { return browserRuntime().open(path); },
  reload() { return browserRuntime().reload(); },
  click(selector) { return browserRuntime().click(selector); },
  fill(selector, value) { return browserRuntime().fill(selector, value); },
  select(selector, value) { return browserRuntime().select(selector, value); },
  press(selector, key) { return browserRuntime().press(selector, key); },
  scroll(selector, x, y) { return browserRuntime().scroll(selector, x, y); },
  text(selector) { return browserRuntime().text(selector); },
  attribute(selector, name) { return browserRuntime().attribute(selector, name); },
  namespace(selector) { return browserRuntime().namespace(selector); },
  count(selector) { return browserRuntime().count(selector); },
  visible(selector) { return browserRuntime().visible(selector); },
  waitFor(selector, state = "visible") { return browserRuntime().waitFor(selector, state); },
  waitForText(selector, text) { return browserRuntime().waitForText(selector, text); },
  currentPath() { return browserRuntime().currentPath(); },
  viewport(width, height) { return browserRuntime().viewport(width, height); },
  timings() { return browserRuntime().timings(); },
  animation(selector) { return browserRuntime().animation(selector); },
  measureClick(selector) { return browserRuntime().measureClick(selector); },
  measureFill(selector, value) { return browserRuntime().measureFill(selector, value); },
  measurePress(selector, key) { return browserRuntime().measurePress(selector, key); },
});
function storageRuntime(area) {
  return Object.freeze({
    get(key) { return browserRuntime().storageGet(area, key); },
    set(key, value) { return browserRuntime().storageSet(area, key, value); },
    remove(key) { return browserRuntime().storageRemove(area, key); },
    clear() { return browserRuntime().storageClear(area); },
  });
}
export const localStorage = storageRuntime("local");
export const sessionStorage = storageRuntime("session");
export const network = Object.freeze({
  respond(path, body, status = 200, contentType = "application/json; charset=utf-8", delayMs = 0) {
    return browserRuntime().networkRespond(path, body, status, contentType, delayMs);
  },
  clear() { return browserRuntime().networkClear(); },
});
`.trimStart()],
]);

export interface VelarWebRuntimeConfig {
  readonly base: string;
  readonly publicConfig?: Readonly<Record<string, unknown>>;
}

export function webModuleSource(source: string, web: VelarWebRuntimeConfig = { base: "/" }): string | null {
  const value = webModuleSources.get(source);
  if (!value) return null;
  if (source === "velar/web") return value.replace(JSON.stringify("__VELAR_WEB_BASE__"), JSON.stringify(web.base));
  if (source === "velar/config") {
    return value.replace(JSON.stringify("__VELAR_PUBLIC_CONFIG__"), JSON.stringify(web.publicConfig ?? {}));
  }
  return value;
}
