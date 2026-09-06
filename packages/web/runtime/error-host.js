const __velarWebErrorNativeObject = globalThis.Object;
const __velarWebErrorNativeNumber = globalThis.Number;
const __velarWebErrorNativePromise = globalThis.Promise;
const __velarWebErrorOwnSymbolsOperation = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarWebErrorFreezeOperation = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarWebErrorFiniteOperation = Object.getOwnPropertyDescriptor(Number, "isFinite")?.value;
const __velarWebErrorPromisePrototype = Object.getOwnPropertyDescriptor(__velarWebErrorNativePromise, "prototype")?.value;
const __velarWebErrorThenOperation = __velarWebErrorPromisePrototype
  ? Object.getOwnPropertyDescriptor(__velarWebErrorPromisePrototype, "then")?.value
  : null;
function __velarWebErrorOwnSymbols(value) {
  return __velarErrorApply(__velarWebErrorOwnSymbolsOperation, __velarWebErrorNativeObject, [value], "Object.getOwnPropertySymbols");
}
function __velarWebErrorFreeze(value) {
  return __velarErrorApply(__velarWebErrorFreezeOperation, __velarWebErrorNativeObject, [value], "Object.freeze");
}
function __velarWebErrorFinite(value) {
  return __velarErrorApply(__velarWebErrorFiniteOperation, __velarWebErrorNativeNumber, [value], "Number.isFinite");
}
function __velarObservePromise(value, onRejected) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  try { return __velarErrorApply(__velarWebErrorThenOperation, value, [undefined, onRejected], "Promise.then"); }
  catch { return null; }
}
