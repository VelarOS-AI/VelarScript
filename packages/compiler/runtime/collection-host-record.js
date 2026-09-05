const __velarCollectionRecordNativeRangeError = globalThis.RangeError;
const __velarCollectionRecordOwnNamesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertyNames")?.value;
const __velarCollectionRecordOwnSymbolsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertySymbols")?.value;
const __velarCollectionRecordDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "defineProperty")?.value;
const __velarCollectionRecordObjectIsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "is")?.value;
const __velarCollectionRecordDeletePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeReflect, "deleteProperty")?.value;
const __velarCollectionRecordFreezeOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "freeze")?.value;
function __velarCollectionRecordGetOwnPropertyDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarCollectionRecordOwnNames(value) { return __velarCollectionHostCall(__velarCollectionRecordOwnNamesOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionRecordOwnSymbols(value) { return __velarCollectionHostCall(__velarCollectionRecordOwnSymbolsOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionRecordDefineProperty(value, key, descriptor) { return __velarCollectionHostCall(__velarCollectionRecordDefinePropertyOperation, __velarCollectionNativeObject, [value, key, descriptor]); }
function __velarCollectionRecordObjectIs(left, right) { return __velarCollectionHostCall(__velarCollectionRecordObjectIsOperation, __velarCollectionNativeObject, [left, right]); }
function __velarCollectionRecordDeleteProperty(value, key) { return __velarCollectionHostCall(__velarCollectionRecordDeletePropertyOperation, __velarCollectionNativeReflect, [value, key]); }
function __velarCollectionRecordFreeze(value) { return __velarCollectionHostCall(__velarCollectionRecordFreezeOperation, __velarCollectionNativeObject, [value]); }
