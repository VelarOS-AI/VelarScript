const __velarMaxListItems = 1000000;
const __velarListArray = Array;
const __velarListArrayIsArray = Array.isArray;
const __velarListGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarListGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarListGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const __velarListSymbolFor = Symbol.for;
const __velarListTypeError = TypeError;
const __velarListRangeError = RangeError;
function __velarListReactiveRuntime() {
  const descriptor = __velarListGetOwnPropertyDescriptor(globalThis, __velarListSymbolFor("velar.runtime.v1"));
  const runtime = descriptor && "value" in descriptor ? descriptor.value : null;
  // No registry means no reactive runtime in this realm, which is ordinary Core
  // behavior. A registry from another generation is a mixed build: reading past
  // it would copy raw values and silently lose every collectionRead dependency,
  // so it fails closed ahead of the callable duck-checks.
  if (!runtime || (typeof runtime !== "object" && typeof runtime !== "function")) return null;
  if (runtime.version !== "0.12") {
    throw new __velarListTypeError("VelarScript reactive runtime schema " + (typeof runtime.version === "string" ? runtime.version : "(unknown)") + " does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  return typeof runtime.toRaw === "function" && typeof runtime.collectionRead === "function" ? runtime : null;
}
function __velarRequireList(value, name) {
  const reactive = __velarListReactiveRuntime();
  if (reactive) value = reactive.toRaw(value);
  if (!__velarListArrayIsArray(value)) throw new __velarListTypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new __velarListRangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (__velarListGetOwnPropertySymbols(value).length > 0
    || __velarListGetOwnPropertyNames(value).length !== value.length + 1) {
    throw new __velarListTypeError(name + " requires a dense List without extra fields");
  }
  const lengthDescriptor = __velarListGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new __velarListTypeError(name + " requires an ordinary mutable List length");
  }
  const output = new __velarListArray(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarListGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new __velarListTypeError(name + " requires ordinary mutable List elements");
    }
    output[index] = reactive ? reactive.collectionRead(value, __velarListSymbolFor("velar.reactive.iterate.v1"), descriptor.value) : descriptor.value;
  }
  return output;
}
