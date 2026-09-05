const __velarCollectionListNativeNumber = globalThis.Number;
const __velarCollectionListNativeMath = globalThis.Math;
const __velarCollectionListNativeRangeError = globalThis.RangeError;
const __velarCollectionListArrayPrototype = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeArray, "prototype")?.value;
const __velarCollectionListOwnNamesOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertyNames")?.value;
const __velarCollectionListOwnSymbolsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "getOwnPropertySymbols")?.value;
const __velarCollectionListDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "defineProperty")?.value;
const __velarCollectionListObjectIsOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionNativeObject, "is")?.value;
const __velarCollectionListIntegerOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isInteger")?.value;
const __velarCollectionListSafeIntegerOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isSafeInteger")?.value;
const __velarCollectionListNaNOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isNaN")?.value;
const __velarCollectionListFiniteOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeNumber, "isFinite")?.value;
const __velarCollectionListMaximumOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeMath, "max")?.value;
const __velarCollectionListMinimumOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListNativeMath, "min")?.value;
const __velarCollectionListJoinOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "join")?.value;
const __velarCollectionListSortOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "sort")?.value;
const __velarCollectionListReverseOperation = __velarCollectionGetOwnPropertyDescriptor(__velarCollectionListArrayPrototype, "reverse")?.value;
function __velarCollectionListIsArray(value) { return __velarCollectionHostCall(__velarCollectionArrayIsArray, __velarCollectionNativeArray, [value]); }
function __velarCollectionListGetOwnPropertyDescriptor(value, key) { return __velarCollectionHostCall(__velarCollectionGetOwnPropertyDescriptor, __velarCollectionNativeObject, [value, key]); }
function __velarCollectionListOwnNames(value) { return __velarCollectionHostCall(__velarCollectionListOwnNamesOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionListOwnSymbols(value) { return __velarCollectionHostCall(__velarCollectionListOwnSymbolsOperation, __velarCollectionNativeObject, [value]); }
function __velarCollectionListDefineProperty(value, key, descriptor) { return __velarCollectionHostCall(__velarCollectionListDefinePropertyOperation, __velarCollectionNativeObject, [value, key, descriptor]); }
function __velarCollectionListObjectIs(left, right) { return __velarCollectionHostCall(__velarCollectionListObjectIsOperation, __velarCollectionNativeObject, [left, right]); }
function __velarCollectionListIsInteger(value) { return __velarCollectionHostCall(__velarCollectionListIntegerOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListIsSafeInteger(value) { return __velarCollectionHostCall(__velarCollectionListSafeIntegerOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListIsNaN(value) { return __velarCollectionHostCall(__velarCollectionListNaNOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListIsFinite(value) { return __velarCollectionHostCall(__velarCollectionListFiniteOperation, __velarCollectionListNativeNumber, [value]); }
function __velarCollectionListMaximum(...values) { return __velarCollectionHostCall(__velarCollectionListMaximumOperation, __velarCollectionListNativeMath, values); }
function __velarCollectionListMinimum(...values) { return __velarCollectionHostCall(__velarCollectionListMinimumOperation, __velarCollectionListNativeMath, values); }
function __velarCollectionListHostJoin(value, separator) { return __velarCollectionHostCall(__velarCollectionListJoinOperation, value, [separator]); }
function __velarCollectionListHostSort(value, compare) { return __velarCollectionHostCall(__velarCollectionListSortOperation, value, [compare]); }
function __velarCollectionListHostReverse(value) { return __velarCollectionHostCall(__velarCollectionListReverseOperation, value, []); }
