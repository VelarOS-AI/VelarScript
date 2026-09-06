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
  ? __velarListReflectApply(__velarListSymbolFor, __velarListNativeSymbol, ["velar.runtime.v1"]) : null;
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
  // No registry means no reactive runtime in this realm, which is ordinary Web
  // behavior. A registry from another generation is a mixed build: reading past
  // it would copy raw values and silently lose every collectionRead dependency,
  // so it fails closed ahead of the callable duck-checks. The one installer
  // that writes this slot always writes version, toRaw, collectionRead and
  // report together, so this test is the same one Core, the JSON bridge and the
  // Web foundation apply to the same slot — one tolerance rule per realm.
  if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
  if (runtime.version !== "0.12") {
    throw new TypeError("VelarScript reactive runtime schema " + (typeof runtime.version === "string" ? runtime.version : "(unknown)") + " does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  return typeof runtime.toRaw === "function" && typeof runtime.collectionRead === "function" ? runtime : null;
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
