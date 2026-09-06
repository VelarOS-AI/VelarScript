const __velarDeepNativeArray = globalThis.Array;
const __velarDeepNativeMap = globalThis.Map;
const __velarDeepNativeSet = globalThis.Set;
const __velarDeepNativeWeakSet = globalThis.WeakSet;
const __velarDeepNativeObject = globalThis.Object;
const __velarDeepGetOwnPropertyDescriptor = __velarDeepNativeObject.getOwnPropertyDescriptor;
const __velarDeepGetOwnPropertyNames = __velarDeepNativeObject.getOwnPropertyNames;
const __velarDeepGetOwnPropertySymbols = __velarDeepNativeObject.getOwnPropertySymbols;
const __velarDeepGetPrototypeOf = __velarDeepNativeObject.getPrototypeOf;
const __velarDeepObjectPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeObject, "prototype")?.value;
const __velarDeepArrayIsArray = __velarDeepNativeArray.isArray;
const __velarDeepApply = __velarDeepGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarDeepArrayPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeArray, "prototype")?.value;
const __velarDeepMapPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeMap, "prototype")?.value;
const __velarDeepSetPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeSet, "prototype")?.value;
const __velarDeepWeakSetPrototype = __velarDeepGetOwnPropertyDescriptor(__velarDeepNativeWeakSet, "prototype")?.value;
const __velarDeepArraySort = __velarDeepGetOwnPropertyDescriptor(__velarDeepArrayPrototype, "sort")?.value;
const __velarDeepMapSize = __velarDeepGetOwnPropertyDescriptor(__velarDeepMapPrototype, "size")?.get;
const __velarDeepMapEntries = __velarDeepGetOwnPropertyDescriptor(__velarDeepMapPrototype, "entries")?.value;
const __velarDeepSetSize = __velarDeepGetOwnPropertyDescriptor(__velarDeepSetPrototype, "size")?.get;
const __velarDeepSetValues = __velarDeepGetOwnPropertyDescriptor(__velarDeepSetPrototype, "values")?.value;
const __velarDeepWeakSetHas = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "has")?.value;
const __velarDeepWeakSetAdd = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "add")?.value;
const __velarDeepWeakSetDelete = __velarDeepGetOwnPropertyDescriptor(__velarDeepWeakSetPrototype, "delete")?.value;
const __velarDeepMapIterator = __velarDeepApply(__velarDeepMapEntries, new __velarDeepNativeMap(), []);
const __velarDeepMapIteratorNext = __velarDeepGetOwnPropertyDescriptor(__velarDeepGetPrototypeOf(__velarDeepMapIterator), "next")?.value;
const __velarDeepSetIterator = __velarDeepApply(__velarDeepSetValues, new __velarDeepNativeSet(), []);
const __velarDeepSetIteratorNext = __velarDeepGetOwnPropertyDescriptor(__velarDeepGetPrototypeOf(__velarDeepSetIterator), "next")?.value;
function __velarDeepCall(operation, receiver, arguments_) { return __velarDeepApply(operation, receiver, arguments_); }
function __velarPlainRecord(value) { const prototype = __velarDeepGetPrototypeOf(value); return prototype === __velarDeepObjectPrototype || prototype === null; }
function __velarDenseList(value) {
  if (!__velarDeepCall(__velarDeepArrayIsArray, __velarDeepNativeArray, [value]) || value.length > 1000000
    || __velarDeepGetOwnPropertySymbols(value).length !== 0
    || __velarDeepGetOwnPropertyNames(value).length !== value.length + 1) return false;
  const lengthDescriptor = __velarDeepGetOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarDeepGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) return false;
  }
  return true;
}
function __velarMapSize(value) { try { return __velarDeepCall(__velarDeepMapSize, value, []); } catch { return null; } }
function __velarSetSize(value) { try { return __velarDeepCall(__velarDeepSetSize, value, []); } catch { return null; } }
function __velarDataRecordKeys(value) {
  if (!__velarPlainRecord(value) || __velarDeepGetOwnPropertySymbols(value).length > 0) return null;
  const keys = __velarDeepGetOwnPropertyNames(value);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarDeepGetOwnPropertyDescriptor(value, keys[index]);
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
  }
  __velarDeepCall(__velarDeepArraySort, keys, []);
  return keys;
}
function __velarDeepIteratorValue(iterator, next) { const step = __velarDeepCall(next, iterator, []); const done = __velarDeepGetOwnPropertyDescriptor(step, "done"); if (!done || !("value" in done) || typeof done.value !== "boolean") return { invalid: true }; if (done.value) return null; const value = __velarDeepGetOwnPropertyDescriptor(step, "value"); return !value || !("value" in value) ? { invalid: true } : { invalid: false, value: value.value }; }
