const __velarBinaryNativeObject = globalThis.Object;
const __velarBinaryNativeArray = globalThis.Array;
const __velarBinaryNativeNumber = globalThis.Number;
const __velarBinaryNativeUint8Array = globalThis.Uint8Array;
const __velarBinaryNativeUint16Array = globalThis.Uint16Array;
const __velarBinaryNativeUint32Array = globalThis.Uint32Array;
const __velarBinaryNativeFloat32Array = globalThis.Float32Array;
const __velarBinaryNativeDataView = globalThis.DataView;
const __velarBinaryNativeWeakMap = globalThis.WeakMap;
const __velarBinaryNativeFunction = globalThis.Function;
const __velarBinaryNativeTypeError = globalThis.TypeError;
const __velarBinaryNativeRangeError = globalThis.RangeError;
const __velarBinaryGetOwnPropertyDescriptor = __velarBinaryNativeObject.getOwnPropertyDescriptor;
const __velarBinaryGetPrototypeOf = __velarBinaryNativeObject.getPrototypeOf;
const __velarBinaryFreeze = __velarBinaryNativeObject.freeze;
const __velarBinaryApply = __velarBinaryGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarBinaryFunctionPrototype = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeFunction, "prototype")?.value;
const __velarBinaryBind = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryFunctionPrototype, "bind")?.value;
const __velarBinaryNumberIsInteger = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isInteger")?.value;
const __velarBinaryNumberIsSafeInteger = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isSafeInteger")?.value;
const __velarBinaryNumberIsFinite = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeNumber, "isFinite")?.value;
const __velarBinaryTypedArrayPrototype = __velarBinaryGetPrototypeOf(__velarBinaryNativeUint8Array.prototype);
const __velarBinaryTypedArrayTag = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, globalThis.Symbol.toStringTag)?.get;
const __velarBinaryTypedArrayLength = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, "length")?.get;
const __velarBinaryTypedArraySet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryTypedArrayPrototype, "set")?.value;
const __velarBinaryWeakMapPrototype = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeWeakMap, "prototype")?.value;
const __velarBinaryWeakMapGet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryWeakMapPrototype, "get")?.value;
const __velarBinaryWeakMapSet = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryWeakMapPrototype, "set")?.value;
if (typeof __velarBinaryApply !== "function" || typeof __velarBinaryBind !== "function" || typeof __velarBinaryNumberIsInteger !== "function"
  || typeof __velarBinaryNumberIsSafeInteger !== "function" || typeof __velarBinaryTypedArrayTag !== "function"
  || typeof __velarBinaryNumberIsFinite !== "function" || typeof __velarBinaryTypedArrayLength !== "function"
  || typeof __velarBinaryTypedArraySet !== "function" || typeof __velarBinaryNativeArray !== "function" || typeof __velarBinaryNativeDataView !== "function"
  || typeof __velarBinaryNativeWeakMap !== "function" || typeof __velarBinaryWeakMapGet !== "function"
  || typeof __velarBinaryWeakMapSet !== "function") {
  throw new __velarBinaryNativeTypeError("The JavaScript typed-array runtime is unavailable");
}
function __velarBinaryCall(operation, receiver, arguments_) { return __velarBinaryApply(operation, receiver, arguments_); }
function __velarBinaryKind(value) {
  try { return __velarBinaryCall(__velarBinaryTypedArrayTag, value, []); }
  catch { return null; }
}
function __velarBinaryLength(value, expected, name) {
  if (__velarBinaryKind(value) !== expected) throw new __velarBinaryNativeTypeError(name + " requires " + expected);
  return __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
}
function __velarBinaryOrder(order) {
  if (order !== "little" && order !== "big") throw new __velarBinaryNativeTypeError("Byte order must be ByteOrder.little or ByteOrder.big");
  return order;
}
function __velarBinaryCheckedIndex(value, index, expected, name) {
  const length = __velarBinaryLength(value, expected, name);
  if (!__velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [index]) || index < 0 || index >= length) {
    throw new __VelarIndexError(name + " index must be an integer from 0 up to but excluding size");
  }
  return index;
}
// 编译器和标准库创建的定长缓冲区已经在入口处完成了品牌与容量校验。把长度
// 记录在私有 WeakMap 中，热路径只需一次不可伪造的身份查询和整数边界判断；
// 来自宿主、尚未经过 parse 的值仍回退到完整品牌检查，安全边界不被放宽。
const __velarBinaryTrustedLengths = new __velarBinaryNativeWeakMap();
// 预绑定捕获的 WeakMap 方法，热路径可直接调用原生 bound function，不必为每次
// 索引重新构造 Reflect.apply 的参数数组。绑定目标和接收者都不再经过可变原型。
const __velarBinaryTrustedLengthGet = __velarBinaryCall(__velarBinaryBind, __velarBinaryWeakMapGet, [__velarBinaryTrustedLengths]);
const __velarBinaryTrustedLengthSet = __velarBinaryCall(__velarBinaryBind, __velarBinaryWeakMapSet, [__velarBinaryTrustedLengths]);
function __velarBinaryTrust(value, length) {
  __velarBinaryTrustedLengthSet(value, length);
  return value;
}
function __velarBinaryTrustedIndex(value, index, expected, name) {
  const trustedLength = __velarBinaryTrustedLengthGet(value);
  if (trustedLength === undefined) return __velarBinaryCheckedIndex(value, index, expected, name);
  if (!__velarBinaryNumberIsInteger(index) || index < 0 || index >= trustedLength) {
    throw new __VelarIndexError(name + " index must be an integer from 0 up to but excluding size");
  }
  return index;
}
function __velarBinarySnapshot(value, expected, Constructor, name) {
  const length = __velarBinaryLength(value, expected, name);
  const bytes = expected === "Uint8Array" ? 1 : expected === "Uint16Array" ? 2 : 4;
  __velarBinarySizeLimit(length, bytes, name);
  const output = new Constructor(length);
  __velarBinaryCall(__velarBinaryTypedArraySet, output, [value]);
  return __velarBinaryTrust(output, length);
}
function __velarBinaryWithinLimit(value, expected, bytes) {
  return __velarBinaryKind(value) === expected
    && __velarBinaryCall(__velarBinaryTypedArrayLength, value, []) <= (64 * 1024 * 1024) / bytes;
}
function __velarBinarySpec(value, name = "Binary buffer") {
  switch (__velarBinaryKind(value)) {
    case "Uint8Array": return { name: "UInt8Buffer", bytes: 1, Constructor: __velarBinaryNativeUint8Array, minimum: 0, maximum: 255, integer: true };
    case "Uint16Array": return { name: "UInt16Buffer", bytes: 2, Constructor: __velarBinaryNativeUint16Array, minimum: 0, maximum: 65535, integer: true };
    case "Uint32Array": return { name: "UInt32Buffer", bytes: 4, Constructor: __velarBinaryNativeUint32Array, minimum: 0, maximum: 4294967295, integer: true };
    case "Float32Array": return { name: "Float32Buffer", bytes: 4, Constructor: __velarBinaryNativeFloat32Array, minimum: -3.4028234663852886e38, maximum: 3.4028234663852886e38, integer: false };
    default: throw new __velarBinaryNativeTypeError(name + " requires a supported fixed numeric buffer");
  }
}
function __velarBinarySizeLimit(size, bytes, name) {
  if (!__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [size]) || size < 0 || size > (64 * 1024 * 1024) / bytes) {
    throw new __velarBinaryNativeRangeError(name + " size exceeds the 64 MiB binary-memory limit");
  }
  return size;
}
function __velarBinaryAllocate(Constructor, bytes, size, name) {
  const length = __velarBinarySizeLimit(size, bytes, name);
  return __velarBinaryTrust(new Constructor(length), length);
}
function __velarBinaryValue(spec, value) {
  const valid = typeof value === "number" && __velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [value])
    && value >= spec.minimum && value <= spec.maximum
    && (!spec.integer || __velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [value]));
  if (!valid) throw new __velarBinaryNativeRangeError(spec.name + " value is outside its supported numeric range");
  return value;
}

export const ByteOrder = __velarRegisterRuntimeType(__velarBinaryFreeze({
  little: "little",
  big: "big",
  is(value) { return value === "little" || value === "big"; },
  parse(value) {
    if (!ByteOrder.is(value)) throw new __velarBinaryNativeTypeError("Value does not match ByteOrder");
    return value;
  },
  values() { return ["little", "big"]; },
}));
export const Bytes = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint8Array", 1); },
  parse(value) { return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "Bytes.parse"); },
  __velarSize: __velarBinarySize,
  __velarIndex: __velarBytesIndex,
  __velarSetIndex: __velarBytesSetIndex,
  __velarUInt8Index,
  __velarUInt8SetIndex,
  __velarUInt16Index,
  __velarUInt16SetIndex,
  __velarUInt32Index,
  __velarUInt32SetIndex,
  __velarFloat32Index,
  __velarFloat32SetIndex,
  __velarBufferCopy,
  __velarBufferSlice,
  __velarBufferToBytes,
  __velarBufferValues,
  __velarBufferIterator,
  __velarBufferPairIterator,
  __velarAdoptTransferredBuffer,
}));
export const UInt8Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint8Array", 1); },
  parse(value) { return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "UInt8Buffer.parse"); },
}));
export const UInt16Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint16Array", 2); },
  parse(value) { return __velarBinarySnapshot(value, "Uint16Array", __velarBinaryNativeUint16Array, "UInt16Buffer.parse"); },
}));
export const UInt32Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryWithinLimit(value, "Uint32Array", 4); },
  parse(value) { return __velarBinarySnapshot(value, "Uint32Array", __velarBinaryNativeUint32Array, "UInt32Buffer.parse"); },
}));
export const Float32Buffer = __velarRegisterRuntimeType(__velarBinaryFreeze({
  is(value) { return __velarBinaryFloat32Is(value); },
  parse(value) { return __velarBinaryFloat32Snapshot(value, "Float32Buffer.parse"); },
}));

export function uint8Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint8Array, 1, size, "uint8Buffer"); }
export function uint16Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint16Array, 2, size, "uint16Buffer"); }
export function uint32Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeUint32Array, 4, size, "uint32Buffer"); }
export function float32Buffer(size) { return __velarBinaryAllocate(__velarBinaryNativeFloat32Array, 4, size, "float32Buffer"); }
export function uint8FromBytes(snapshot) { return __velarBinarySnapshot(snapshot, "Uint8Array", __velarBinaryNativeUint8Array, "uint8FromBytes"); }
export function uint16FromBytes(snapshot, order) {
  return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeUint16Array, 2, "uint16FromBytes", "getUint16");
}
export function uint32FromBytes(snapshot, order) { return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeUint32Array, 4, "uint32FromBytes", "getUint32"); }
export function float32FromBytes(snapshot, order) { return __velarBufferFromBytes(snapshot, order, __velarBinaryNativeFloat32Array, 4, "float32FromBytes", "getFloat32", __velarBinaryFloat32Value); }
function __velarBinarySize(value) {
  const kind = __velarBinaryKind(value);
  if (kind !== "Uint8Array" && kind !== "Uint16Array" && kind !== "Uint32Array" && kind !== "Float32Array") throw new __velarBinaryNativeTypeError("Binary size requires Bytes or a fixed numeric buffer");
  return __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
}
function __velarBytesIndex(value, index) {
  return value[__velarBinaryTrustedIndex(value, index, "Uint8Array", "Bytes")];
}
function __velarBytesSetIndex() {
  throw new __velarBinaryNativeTypeError("Bytes is a read-only binary snapshot");
}
function __velarBinaryIntegerValue(value, minimum, maximum, name) {
  if (!__velarBinaryCall(__velarBinaryNumberIsInteger, __velarBinaryNativeNumber, [value]) || value < minimum || value > maximum) throw new __velarBinaryNativeRangeError(name + " value is outside its supported integer range");
  return value;
}
function __velarBinaryFloat32Value(value) {
  if (typeof value !== "number" || !__velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [value]) || value < -3.4028234663852886e38 || value > 3.4028234663852886e38) throw new __velarBinaryNativeRangeError("Float32Buffer value is outside its supported finite range");
  return value;
}
function __velarBinaryFloat32Is(value) {
  if (__velarBinaryKind(value) !== "Float32Array") return false;
  const length = __velarBinaryCall(__velarBinaryTypedArrayLength, value, []);
  if (length > (64 * 1024 * 1024) / 4) return false;
  for (let index = 0; index < length; index += 1) {
    const item = value[index];
    if (typeof item !== "number" || !__velarBinaryCall(__velarBinaryNumberIsFinite, __velarBinaryNativeNumber, [item])) return false;
  }
  return true;
}
function __velarBinaryFloat32Snapshot(value, name) {
  const length = __velarBinaryLength(value, "Float32Array", name);
  __velarBinarySizeLimit(length, 4, name);
  const output = new __velarBinaryNativeFloat32Array(length);
  for (let index = 0; index < length; index += 1) output[index] = __velarBinaryFloat32Value(value[index]);
  return __velarBinaryTrust(output, length);
}
function __velarUInt8Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint8Array", "UInt8Buffer")]; }
function __velarUInt8SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint8Array", "UInt8Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 255, "UInt8Buffer");
  return next;
}
function __velarUInt16Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint16Array", "UInt16Buffer")]; }
function __velarUInt16SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint16Array", "UInt16Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 65535, "UInt16Buffer");
  return next;
}
function __velarUInt32Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Uint32Array", "UInt32Buffer")]; }
function __velarUInt32SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Uint32Array", "UInt32Buffer");
  value[index] = __velarBinaryIntegerValue(next, 0, 4294967295, "UInt32Buffer");
  return next;
}
function __velarFloat32Index(value, index) { return value[__velarBinaryTrustedIndex(value, index, "Float32Array", "Float32Buffer")]; }
function __velarFloat32SetIndex(value, index, next) {
  index = __velarBinaryTrustedIndex(value, index, "Float32Array", "Float32Buffer");
  value[index] = __velarBinaryFloat32Value(next);
  return next;
}
function __velarBufferCopy(value) { return __velarBufferSlice(value, 0, __velarBinarySize(value)); }
function __velarBufferValues(value) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (length > 1000000) throw new __velarBinaryNativeRangeError(spec.name + ".values cannot produce more than 1000000 List items");
  const output = new __velarBinaryNativeArray(length);
  for (let index = 0; index < length; index += 1) output[index] = value[index];
  return output;
}
function* __velarBufferIterator(value) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  __velarBinarySizeLimit(length, spec.bytes, spec.name + " iteration");
  for (let index = 0; index < length; index += 1) yield value[index];
}
function* __velarBufferPairIterator(value) {
  let index = 0;
  for (const item of __velarBufferIterator(value)) yield [item, index++];
}
// Worker structured cloning gives the receiver exclusive ownership of every
// transferred full-buffer view. Validate that view once and register its
// length in the same private fast-path memo used by standard-library-created
// buffers; no public source operation can claim this privilege.
function __velarAdoptTransferredBuffer(value) {
  const spec = __velarBinarySpec(value, "Transferred binary buffer");
  const length = __velarBinarySize(value);
  __velarBinarySizeLimit(length, spec.bytes, spec.name + " transfer");
  if (!spec.integer) {
    for (let index = 0; index < length; index += 1) __velarBinaryFloat32Value(value[index]);
  }
  return __velarBinaryTrust(value, length);
}
function __velarBufferSlice(value, start = 0, end = __velarBinarySize(value)) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (!__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [start]) || !__velarBinaryCall(__velarBinaryNumberIsSafeInteger, __velarBinaryNativeNumber, [end]) || start < 0 || end < start || end > length) {
    throw new __velarBinaryNativeRangeError(spec.name + ".slice requires 0 <= start <= end <= size");
  }
  const output = new spec.Constructor(end - start);
  for (let index = start; index < end; index += 1) output[index - start] = value[index];
  return __velarBinaryTrust(output, end - start);
}
function __velarBufferToBytes(value, order = null) {
  const spec = __velarBinarySpec(value);
  const length = __velarBinarySize(value);
  if (spec.bytes === 1) return __velarBinarySnapshot(value, "Uint8Array", __velarBinaryNativeUint8Array, "UInt8Buffer.toBytes");
  order = __velarBinaryOrder(order);
  const output = new __velarBinaryNativeUint8Array(length * spec.bytes);
  const view = new __velarBinaryNativeDataView(output.buffer);
  const operation = spec.name === "UInt16Buffer" ? "setUint16" : spec.name === "UInt32Buffer" ? "setUint32" : "setFloat32";
  const setter = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeDataView.prototype, operation)?.value;
  if (typeof setter !== "function") throw new __velarBinaryNativeTypeError("DataView " + operation + " is unavailable");
  for (let index = 0; index < length; index += 1) {
    __velarBinaryCall(setter, view, [index * spec.bytes, value[index], order === "little"]);
  }
  return __velarBinaryTrust(output, length * spec.bytes);
}
function __velarBufferFromBytes(snapshot, order, Constructor, bytes, name, operation, validate = null) {
  const length = __velarBinaryLength(snapshot, "Uint8Array", name);
  __velarBinarySizeLimit(length, 1, name);
  order = __velarBinaryOrder(order);
  if (length % bytes !== 0) throw new __velarBinaryNativeRangeError(name + " requires a byte length divisible by " + bytes);
  const output = __velarBinaryAllocate(Constructor, bytes, length / bytes, name);
  const view = new __velarBinaryNativeDataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  const getter = __velarBinaryGetOwnPropertyDescriptor(__velarBinaryNativeDataView.prototype, operation)?.value;
  if (typeof getter !== "function") throw new __velarBinaryNativeTypeError("DataView " + operation + " is unavailable");
  for (let index = 0; index < output.length; index += 1) {
    const item = __velarBinaryCall(getter, view, [index * bytes, order === "little"]);
    output[index] = validate === null ? item : validate(item);
  }
  return output;
}
const __velarBinaryBuilders = new __velarBinaryNativeWeakMap();
const __velarBinaryBuilderPrototype = __velarBinaryFreeze({
  get size() { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state) throw new __velarBinaryNativeTypeError("Builder size requires a binary builder"); return state.size; },
  get maxElements() { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state) throw new __velarBinaryNativeTypeError("Builder maxElements requires a binary builder"); return state.maximum; },
  push(value) {
    const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state || state.finished) throw new __velarBinaryNativeTypeError("Binary builder is finished");
    if (state.size >= state.maximum) throw new __velarBinaryNativeRangeError(state.spec.name + " builder exceeds maxElements");
    if (state.size === state.storage.length) { let capacity = state.storage.length * 2; if (capacity < 8) capacity = 8; if (capacity > state.maximum) capacity = state.maximum; const storage = new state.spec.Constructor(capacity); __velarBinaryCall(__velarBinaryTypedArraySet, storage, [state.storage]); state.storage = storage; }
    state.storage[state.size] = __velarBinaryValue(state.spec, value); state.size += 1; return null;
  },
  finish() {
    const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [this]); if (!state || state.finished) throw new __velarBinaryNativeTypeError("Binary builder is finished");
    let output = state.storage;
    if (state.size !== output.length) { output = new state.spec.Constructor(state.size); for (let index = 0; index < state.size; index += 1) output[index] = state.storage[index]; }
    state.finished = true; state.storage = null; return __velarBinaryTrust(output, state.size);
  },
});
function __velarBinaryBuilder(maximum, Constructor, bytes, name) {
  maximum = __velarBinarySizeLimit(maximum, bytes, name);
  const value = __velarBinaryFreeze(__velarBinaryNativeObject.create(__velarBinaryBuilderPrototype));
  const empty = new Constructor(maximum < 256 ? maximum : 256);
  __velarBinaryCall(__velarBinaryWeakMapSet, __velarBinaryBuilders, [value, { maximum, size: 0, storage: empty, spec: __velarBinarySpec(empty), finished: false }]);
  return value;
}
function __velarBinaryBuilderType(name, Constructor) { return __velarRegisterRuntimeType(__velarBinaryFreeze({ is(value) { const state = __velarBinaryCall(__velarBinaryWeakMapGet, __velarBinaryBuilders, [value]); return !!state && state.spec.Constructor === Constructor && !state.finished; }, parse(value) { if (!this.is(value)) throw new __velarBinaryNativeTypeError("Value does not match " + name); return value; } })); }
export const UInt32Builder = __velarBinaryBuilderType("UInt32Builder", __velarBinaryNativeUint32Array);
export const Float32Builder = __velarBinaryBuilderType("Float32Builder", __velarBinaryNativeFloat32Array);
export function uint32Builder(maxElements) { return __velarBinaryBuilder(maxElements, __velarBinaryNativeUint32Array, 4, "uint32Builder"); }
export function float32Builder(maxElements) { return __velarBinaryBuilder(maxElements, __velarBinaryNativeFloat32Array, 4, "float32Builder"); }
