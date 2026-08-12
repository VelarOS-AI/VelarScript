import { VELAR_COLLECTION_IDENTITY_RUNTIME, VELAR_COLLECTION_TYPE_RUNTIME } from "./collection-runtime.ts";
import { VELAR_TYPE_REGISTRY_RUNTIME } from "./type-registry-runtime.ts";

/**
 * Canonical generated runtime for data Type traversal. Runtime Type identity
 * remains owned by type-registry-runtime.ts; this fragment owns only the
 * per-validation graph state and host operations used by generated validators.
 */
export const VELAR_TYPE_VALIDATION_RUNTIME = String.raw`
const __velarValidationNativeWeakMap = globalThis.WeakMap;
const __velarValidationNativeSet = globalThis.Set;
const __velarValidationNativePromise = globalThis.Promise;
const __velarValidationNativeFunction = globalThis.Function;
const __velarValidationNativeSymbol = globalThis.Symbol;
const __velarValidationWeakMapPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeWeakMap, "prototype")?.value;
const __velarValidationSetPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeSet, "prototype")?.value;
const __velarValidationFunctionPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeFunction, "prototype")?.value;
const __velarValidationHasInstanceSymbol = __velarCollectionGetOwnPropertyDescriptor(__velarValidationNativeSymbol, "hasInstance")?.value;
const __velarValidationWeakMapGetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "get")?.value;
const __velarValidationWeakMapSetOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "set")?.value;
const __velarValidationWeakMapDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationWeakMapPrototype, "delete")?.value;
const __velarValidationSetHasOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "has")?.value;
const __velarValidationSetAddOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "add")?.value;
const __velarValidationSetDeleteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "delete")?.value;
const __velarValidationSetSizeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationSetPrototype, "size")?.get;
const __velarValidationFunctionHasInstanceOperation = __velarCollectionGetOwnPropertyDescriptor(__velarValidationFunctionPrototype, __velarValidationHasInstanceSymbol)?.value;
const __velarValidationFreezeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "freeze")?.value;
function __velarValidationState() { return { active: new __velarValidationNativeWeakMap(), depth: 0 }; }
function __velarValidationSet() { return new __velarValidationNativeSet(); }
function __velarValidationWeakMapGet(value, key) { return __velarCollectionHostCall(__velarValidationWeakMapGetOperation, value, [key]); }
function __velarValidationWeakMapSet(value, key, item) { return __velarCollectionHostCall(__velarValidationWeakMapSetOperation, value, [key, item]); }
function __velarValidationWeakMapDelete(value, key) { return __velarCollectionHostCall(__velarValidationWeakMapDeleteOperation, value, [key]); }
function __velarValidationSetHas(value, item) { return __velarCollectionHostCall(__velarValidationSetHasOperation, value, [item]); }
function __velarValidationSetAdd(value, item) { return __velarCollectionHostCall(__velarValidationSetAddOperation, value, [item]); }
function __velarValidationSetDelete(value, item) { return __velarCollectionHostCall(__velarValidationSetDeleteOperation, value, [item]); }
function __velarValidationSetSize(value) { return __velarCollectionHostCall(__velarValidationSetSizeOperation, value, []); }
function __velarValidationIsArray(value) { return __velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]); }
function __velarValidationOwnDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarValidationIsInstance(value, constructor) { return __velarCollectionHostCall(__velarValidationFunctionHasInstanceOperation, constructor, [value]); }
function __velarValidationIsPromise(value) { return __velarValidationIsInstance(value, __velarValidationNativePromise); }
function __velarValidationFreeze(value) { return __velarCollectionHostCall(__velarValidationFreezeOperation, __velarCollectionNativeObject, [value]); }
// A record contract accepts only plain data objects: prototype null, or a
// prototype that itself has none (some realm's Object.prototype). The check
// is structural rather than an identity comparison so plain values from other
// realms validate, while class instances, Error values, and host objects are
// rejected — their prototypes always chain through another object.
function __velarValidationIsPlainObject(value) {
  const prototype = __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [value]);
  if (prototype === null) return true;
  return __velarCollectionHostCall(__velarCollectionGetPrototypeOf, __velarCollectionNativeObject, [prototype]) === null;
}
// Teaching suffix for record parse failures caused by the plain-object rule.
function __velarValidationRejectionHint(value) {
  if (value === null || typeof value !== "object" || __velarValidationIsArray(value) || __velarValidationIsPlainObject(value)) return "";
  return "; a record accepts only plain data objects — project the fields into a record first, for example {x: instance.x}";
}
`.trimStart();

/** Stateless traversal for collection-shaped runtime Types. */
export const VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME = String.raw`
function __velarListTypeIs(value, check) {
  if (!__velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]) || value.length > 1000000 || __velarCollectionHostCall(__velarCollectionOwnSymbols, __velarCollectionNativeObject, [value]).length > 0 || __velarCollectionHostCall(__velarCollectionOwnNames, __velarCollectionNativeObject, [value]).length !== value.length + 1) return false;
  const lengthDescriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, "length"]);
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable || lengthDescriptor.configurable || !("value" in lengthDescriptor)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, index]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor) || !check(descriptor.value)) return false;
  }
  return true;
}

function __velarSetTypeIs(value, check) {
  if (!__velarIsSet(value) || __velarCollectionHostCall(__velarCollectionSetSize, value, []) > 1000000) return false;
  const iterator = __velarCollectionSetTypeIterator(value);
  while (true) { const step = __velarCollectionSetTypeNext(iterator); if (step.done) break; if (!check(step.value)) return false; }
  return true;
}

function __velarMapTypeIs(value, check) {
  if (!__velarIsMap(value) || __velarCollectionHostCall(__velarCollectionMapSize, value, []) > 1000000) return false;
  const iterator = __velarCollectionMapTypeIterator(value);
  while (true) { const step = __velarCollectionMapTypeNext(iterator); if (step.done) break; const entry = step.value; if (!check(entry[0], entry[1])) return false; }
  return true;
}

function __velarRecordTypeIs(value, check) {
  if (!__velarIsRecord(value)) return false;
  const keys = __velarCollectionHostCall(__velarCollectionOwnKeys, __velarCollectionNativeReflect, [value]);
  if (keys.length > 1000000) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") return false;
    const descriptor = __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor) || !check(descriptor.value)) return false;
  }
  return true;
}
`.trimStart();

export const VELAR_VALIDATION_ERROR_RUNTIME = String.raw`
class __VelarValidationError extends __velarCollectionNativeTypeError {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
`.trimStart();

export const VELAR_TYPE_VALIDATION_MODULE = "velar/compiler-runtime-types-v1";

/**
 * Project-shared runtime-Type host ABI. Generated predicates and Type values
 * remain in their source modules; only immutable host operations and fresh
 * per-call traversal state cross the project boundary.
 */
export const VELAR_TYPE_VALIDATION_MODULE_SOURCE = String.raw`
${VELAR_COLLECTION_IDENTITY_RUNTIME}
${VELAR_COLLECTION_TYPE_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_TYPE_VALIDATION_RUNTIME}
${VELAR_RUNTIME_TYPE_COLLECTION_RUNTIME}
${VELAR_VALIDATION_ERROR_RUNTIME}
export {
  __velarRegisterRuntimeType as registerRuntimeType,
  __velarValidationState as validationState,
  __velarValidationSet as validationSet,
  __velarValidationWeakMapGet as validationWeakMapGet,
  __velarValidationWeakMapSet as validationWeakMapSet,
  __velarValidationWeakMapDelete as validationWeakMapDelete,
  __velarValidationSetHas as validationSetHas,
  __velarValidationSetAdd as validationSetAdd,
  __velarValidationSetDelete as validationSetDelete,
  __velarValidationSetSize as validationSetSize,
  __velarValidationIsArray as validationIsArray,
  __velarValidationOwnDescriptor as validationOwnDescriptor,
  __velarValidationIsInstance as validationIsInstance,
  __velarValidationIsPromise as validationIsPromise,
  __velarValidationIsPlainObject as validationIsPlainObject,
  __velarValidationRejectionHint as validationRejectionHint,
  __velarValidationFreeze as validationFreeze,
  __velarListTypeIs as listTypeIs,
  __velarSetTypeIs as setTypeIs,
  __velarMapTypeIs as mapTypeIs,
  __velarRecordTypeIs as recordTypeIs,
  __VelarValidationError as ValidationError,
};
`.trimStart();
