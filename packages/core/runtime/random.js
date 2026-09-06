const __velarRandomNativeObject = globalThis.Object;
const __velarRandomNativeNumber = globalThis.Number;
const __velarRandomNativeArray = globalThis.Array;
const __velarRandomNativeWeakMap = globalThis.WeakMap;
const __velarRandomNativeTypeError = globalThis.TypeError;
const __velarRandomNativeRangeError = globalThis.RangeError;
const __velarRandomNativeMath = globalThis.Math;
const __velarRandomGetOwnPropertyDescriptor = __velarRandomNativeObject.getOwnPropertyDescriptor;
const __velarRandomFreeze = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeObject, "freeze")?.value;
const __velarRandomCreate = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeObject, "create")?.value;
const __velarRandomApply = __velarRandomGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarRandomNumberIsSafeInteger = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeNumber, "isSafeInteger")?.value;
const __velarRandomArrayIsArray = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeArray, "isArray")?.value;
const __velarRandomMathImul = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeMath, "imul")?.value;
const __velarRandomMathFloor = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeMath, "floor")?.value;
const __velarRandomStringPrototype = __velarRandomGetOwnPropertyDescriptor(globalThis.String, "prototype")?.value;
const __velarRandomStringCharCodeAt = __velarRandomGetOwnPropertyDescriptor(__velarRandomStringPrototype, "charCodeAt")?.value;
const __velarRandomWeakMapPrototype = __velarRandomGetOwnPropertyDescriptor(__velarRandomNativeWeakMap, "prototype")?.value;
const __velarRandomWeakMapGet = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "get")?.value;
const __velarRandomWeakMapHas = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "has")?.value;
const __velarRandomWeakMapSet = __velarRandomGetOwnPropertyDescriptor(__velarRandomWeakMapPrototype, "set")?.value;
if (typeof __velarRandomFreeze !== "function" || typeof __velarRandomCreate !== "function" || typeof __velarRandomApply !== "function"
  || typeof __velarRandomNumberIsSafeInteger !== "function" || typeof __velarRandomArrayIsArray !== "function"
  || typeof __velarRandomMathImul !== "function" || typeof __velarRandomMathFloor !== "function"
  || typeof __velarRandomStringCharCodeAt !== "function" || typeof __velarRandomWeakMapGet !== "function"
  || typeof __velarRandomWeakMapHas !== "function" || typeof __velarRandomWeakMapSet !== "function") {
  throw new __velarRandomNativeTypeError("The deterministic random runtime is unavailable");
}
function __velarRandomCall(operation, receiver, arguments_) { return __velarRandomApply(operation, receiver, arguments_); }
function __velarRandomImul(left, right) { return __velarRandomCall(__velarRandomMathImul, __velarRandomNativeMath, [left, right]); }
function __velarRandomRotl(value, count) { return (value << count | value >>> (32 - count)) >>> 0; }
function __velarRandomHash(text) {
  let first = (1779033703 ^ text.length) >>> 0;
  let second = (3144134277 ^ text.length) >>> 0;
  let third = (1013904242 ^ text.length) >>> 0;
  let fourth = (2773480762 ^ text.length) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = __velarRandomCall(__velarRandomStringCharCodeAt, text, [index]);
    first = second ^ __velarRandomImul(first ^ code, 597399067);
    second = third ^ __velarRandomImul(second ^ code, 2869860233);
    third = fourth ^ __velarRandomImul(third ^ code, 951274213);
    fourth = first ^ __velarRandomImul(fourth ^ code, 2716044179);
  }
  first = __velarRandomImul(third ^ first >>> 18, 597399067);
  second = __velarRandomImul(fourth ^ second >>> 22, 2869860233);
  third = __velarRandomImul(first ^ third >>> 17, 951274213);
  fourth = __velarRandomImul(second ^ fourth >>> 19, 2716044179);
  const output = new __velarRandomNativeArray(4);
  output[0] = first >>> 0;
  output[1] = second >>> 0;
  output[2] = third >>> 0;
  output[3] = fourth >>> 0;
  if ((output[0] | output[1] | output[2] | output[3]) === 0) output[0] = 1;
  return output;
}
function __velarRandomSeed(seed) {
  if (typeof seed === "string") return __velarRandomHash("s:" + seed);
  if (typeof seed !== "number" || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [seed])) {
    throw new __velarRandomNativeTypeError("random seed must be a string or safe integer");
  }
  return __velarRandomHash("n:" + seed);
}
const __velarRandomStates = new __velarRandomNativeWeakMap();
function __velarRandomState(value) {
  const state = __velarRandomCall(__velarRandomWeakMapGet, __velarRandomStates, [value]);
  if (state === undefined) throw new __velarRandomNativeTypeError("Random method requires a Random receiver");
  return state;
}
function __velarRandomNext(receiver) {
  const state = __velarRandomState(receiver).state;
  const result = __velarRandomImul(__velarRandomRotl(__velarRandomImul(state[1], 5) >>> 0, 7), 9) >>> 0;
  const temporary = state[1] << 9;
  state[2] ^= state[0]; state[3] ^= state[1]; state[1] ^= state[2]; state[0] ^= state[3]; state[2] ^= temporary;
  state[3] = __velarRandomRotl(state[3], 11);
  state[0] >>>= 0; state[1] >>>= 0; state[2] >>>= 0;
  return result;
}
function __velarRandomRange(start, end) {
  if (end === null) { end = start; start = 0; }
  const width = end - start;
  if (!__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [start])
    || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [end])
    || !__velarRandomCall(__velarRandomNumberIsSafeInteger, __velarRandomNativeNumber, [width])
    || width <= 0) {
    throw new __velarRandomNativeRangeError("Random.int requires an increasing safe-integer range");
  }
  return [start, width];
}
const __velarRandomPrototype = {
  number() { return __velarRandomNext(this) / 4294967296; },
  int(start, end = null) {
    const range = __velarRandomRange(start, end);
    if (range[1] <= 4294967296) {
      const limit = __velarRandomCall(__velarRandomMathFloor, __velarRandomNativeMath, [4294967296 / range[1]]) * range[1];
      let value; do { value = __velarRandomNext(this); } while (value >= limit);
      return range[0] + value % range[1];
    }
    const limit = __velarRandomCall(__velarRandomMathFloor, __velarRandomNativeMath, [9007199254740992 / range[1]]) * range[1];
    let value; do { value = __velarRandomNext(this) * 2097152 + (__velarRandomNext(this) >>> 11); } while (value >= limit);
    return range[0] + value % range[1];
  },
  bool(probability = 0.5) {
    if (typeof probability !== "number" || probability < 0 || probability > 1 || probability !== probability) throw new __velarRandomNativeRangeError("Random.bool probability must be a number from 0 through 1");
    if (probability === 0) return false;
    if (probability === 1) return true;
    return this.number() < probability;
  },
  pick(values) {
    if (!__velarRandomCall(__velarRandomArrayIsArray, __velarRandomNativeArray, [values])) throw new __velarRandomNativeTypeError("Random.pick requires a List");
    if (values.length === 0) throw new __velarRandomNativeRangeError("Random.pick requires a non-empty List");
    return values[this.int(values.length)];
  },
  shuffle(values) {
    if (!__velarRandomCall(__velarRandomArrayIsArray, __velarRandomNativeArray, [values])) throw new __velarRandomNativeTypeError("Random.shuffle requires a List");
    const output = new __velarRandomNativeArray(values.length);
    for (let index = 0; index < values.length; index += 1) output[index] = values[index];
    for (let index = output.length - 1; index > 0; index -= 1) { const other = this.int(index + 1); const value = output[index]; output[index] = output[other]; output[other] = value; }
    return output;
  },
  fork(label) {
    if (typeof label !== "string") throw new __velarRandomNativeTypeError("Random.fork label must be a string");
    const key = __velarRandomState(this).key;
    return __velarRandomMake(__velarRandomHash("f:" + key[0] + ":" + key[1] + ":" + key[2] + ":" + key[3] + ":" + label));
  },
};
__velarRandomFreeze(__velarRandomPrototype);
function __velarRandomMake(key) {
  const value = __velarRandomCreate(__velarRandomPrototype);
  __velarRandomCall(__velarRandomWeakMapSet, __velarRandomStates, [value, { key: [key[0], key[1], key[2], key[3]], state: [key[0], key[1], key[2], key[3]] }]);
  return __velarRandomFreeze(value);
}
export const Random = __velarRegisterRuntimeType(__velarRandomFreeze({
  is(value) { return (typeof value === "object" || typeof value === "function") && value !== null && __velarRandomCall(__velarRandomWeakMapHas, __velarRandomStates, [value]); },
  parse(value) { if (!Random.is(value)) throw new __velarRandomNativeTypeError("Value does not match Random"); return value; },
}));
export function random(seed) { return __velarRandomMake(__velarRandomSeed(seed)); }
