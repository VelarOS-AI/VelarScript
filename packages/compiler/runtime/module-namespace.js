const __velarModuleNativeObject = globalThis.Object;
const __velarModuleNativeWeakMap = globalThis.WeakMap;
const __velarModuleNativeProxy = globalThis.Proxy;
const __velarModuleNativeTypeError = globalThis.TypeError;
const __velarModuleOwnDescriptor = __velarModuleNativeObject.getOwnPropertyDescriptor;
const __velarModuleCreate = __velarModuleOwnDescriptor(__velarModuleNativeObject, "create")?.value;
const __velarModuleDefine = __velarModuleOwnDescriptor(__velarModuleNativeObject, "defineProperty")?.value;
const __velarModulePreventExtensions = __velarModuleOwnDescriptor(__velarModuleNativeObject, "preventExtensions")?.value;
const __velarModuleApply = __velarModuleOwnDescriptor(globalThis.Reflect, "apply")?.value;
const __velarModuleSort = __velarModuleOwnDescriptor(globalThis.Array.prototype, "sort")?.value;
const __velarModuleWeakMapPrototype = __velarModuleOwnDescriptor(__velarModuleNativeWeakMap, "prototype")?.value;
const __velarModuleWeakMapGet = __velarModuleOwnDescriptor(__velarModuleWeakMapPrototype, "get")?.value;
const __velarModuleWeakMapHas = __velarModuleOwnDescriptor(__velarModuleWeakMapPrototype, "has")?.value;
const __velarModuleWeakMapSet = __velarModuleOwnDescriptor(__velarModuleWeakMapPrototype, "set")?.value;
const __velarModulePromiseThen = __velarModuleOwnDescriptor(globalThis.Promise.prototype, "then")?.value;
const __velarModuleSymbolFor = __velarModuleOwnDescriptor(globalThis.Symbol, "for")?.value;
function __velarModuleCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarModuleApply !== "function") throw new __velarModuleNativeTypeError("The JavaScript module namespace runtime is unavailable");
  return __velarModuleApply(operation, receiver, arguments_);
}
const __velarModuleRegistryKey = __velarModuleCall(__velarModuleSymbolFor, globalThis.Symbol, ["velar.module.namespace.v1"]);
const __velarModuleViews = (() => {
  const descriptor = __velarModuleOwnDescriptor(globalThis, __velarModuleRegistryKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) throw new __velarModuleNativeTypeError("VelarScript module namespace registry ownership is invalid");
    try { __velarModuleCall(__velarModuleWeakMapHas, descriptor.value, [descriptor.value]); }
    catch { throw new __velarModuleNativeTypeError("VelarScript module namespace registry is invalid"); }
    return descriptor.value;
  }
  const registry = new __velarModuleNativeWeakMap();
  __velarModuleCall(__velarModuleDefine, __velarModuleNativeObject, [globalThis, __velarModuleRegistryKey, {value: registry, enumerable: false, configurable: false, writable: false}]);
  return registry;
})();
function __velarModuleNamespace(raw, publicNames) {
  const known = __velarModuleCall(__velarModuleWeakMapGet, __velarModuleViews, [raw]);
  if (known) return known;
  const target = __velarModuleCall(__velarModuleCreate, __velarModuleNativeObject, [null]);
  const names = [];
  for (let index = 0; index < publicNames.length; index += 1) names[index] = publicNames[index];
  __velarModuleCall(__velarModuleSort, names, []);
  for (let index = 0; index < names.length; index += 1) {
    __velarModuleCall(__velarModuleDefine, __velarModuleNativeObject, [target, names[index], {value: undefined, enumerable: true, configurable: false, writable: true}]);
  }
  __velarModuleCall(__velarModulePreventExtensions, __velarModuleNativeObject, [target]);
  // Creating the view must not read a binding: a cycle may expose a namespace
  // before its lexical exports initialize. Data descriptors read only the
  // requested binding, so checked record spread stays live and retains TDZ.
  const view = new __velarModuleNativeProxy(target, {
    get(object, key) {
      return __velarModuleOwnDescriptor(object, key) ? raw[key] : undefined;
    },
    getOwnPropertyDescriptor(object, key) {
      if (!__velarModuleOwnDescriptor(object, key)) return undefined;
      return {value: raw[key], enumerable: true, configurable: false, writable: true};
    },
    set() { return false; },
    defineProperty() { return false; },
  });
  __velarModuleCall(__velarModuleWeakMapSet, __velarModuleViews, [raw, view]);
  return view;
}
function __velarImportModule(promise, receive, publicNames) {
  // This is the only observer of the native import. The returned chain owns
  // both import and callback failures, and records raw bindings before any
  // caller observes the public namespace.
  return __velarModuleCall(__velarModulePromiseThen, promise, [(raw) => {
    receive(raw);
    return __velarModuleNamespace(raw, publicNames);
  }]);
}
