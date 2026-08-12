/** Canonical generated runtime for checked Number receiver methods. */
export const VELAR_NUMBER_METHOD_RUNTIME = String.raw`
const __velarNumberNativeMath = globalThis.Math;
const __velarNumberNativeNumber = globalThis.Number;
const __velarNumberNativeObject = globalThis.Object;
const __velarNumberNativeTypeError = globalThis.TypeError;
const __velarNumberNativeRangeError = globalThis.RangeError;
const __velarNumberGetOwnPropertyDescriptor = __velarNumberNativeObject.getOwnPropertyDescriptor;
const __velarNumberReflectApply = __velarNumberGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarNumberPrototype = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeNumber, "prototype")?.value;
const __velarNumberMathAbs = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeMath, "abs")?.value;
const __velarNumberMathRound = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeMath, "round")?.value;
const __velarNumberMathFloor = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeMath, "floor")?.value;
const __velarNumberMathCeil = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeMath, "ceil")?.value;
const __velarNumberIsSafeInteger = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeNumber, "isSafeInteger")?.value;
const __velarNumberNativeIsInteger = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeNumber, "isInteger")?.value;
const __velarNumberNativeIsNaN = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeNumber, "isNaN")?.value;
const __velarNumberNativeIsFinite = __velarNumberGetOwnPropertyDescriptor(__velarNumberNativeNumber, "isFinite")?.value;
const __velarNativeNumberToFixed = __velarNumberGetOwnPropertyDescriptor(__velarNumberPrototype, "toFixed")?.value;
function __velarNumberCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarNumberReflectApply !== "function") throw new __velarNumberNativeTypeError("The JavaScript Number runtime is unavailable");
  return __velarNumberReflectApply(operation, receiver, arguments_);
}
function __velarNumberValue(value) { if (typeof value !== "number") throw new __velarNumberNativeTypeError("Number methods require a number receiver"); return value; }
function __velarNumberAbs(value) { return __velarNumberCall(__velarNumberMathAbs, __velarNumberNativeMath, [__velarNumberValue(value)]); }
function __velarNumberRound(value) { return __velarNumberCall(__velarNumberMathRound, __velarNumberNativeMath, [__velarNumberValue(value)]); }
function __velarNumberFloor(value) { return __velarNumberCall(__velarNumberMathFloor, __velarNumberNativeMath, [__velarNumberValue(value)]); }
function __velarNumberCeil(value) { return __velarNumberCall(__velarNumberMathCeil, __velarNumberNativeMath, [__velarNumberValue(value)]); }
function __velarNumberToFixed(value, digits) {
  if (!__velarNumberCall(__velarNumberIsSafeInteger, __velarNumberNativeNumber, [digits]) || digits < 0 || digits > 100) throw new __velarNumberNativeRangeError("Number.toFixed digits must be an integer from 0 through 100");
  return __velarNumberCall(__velarNativeNumberToFixed, __velarNumberValue(value), [digits]);
}
function __velarNumberIsInteger(value) { return __velarNumberCall(__velarNumberNativeIsInteger, __velarNumberNativeNumber, [__velarNumberValue(value)]); }
function __velarNumberIsNaN(value) { return __velarNumberCall(__velarNumberNativeIsNaN, __velarNumberNativeNumber, [__velarNumberValue(value)]); }
function __velarNumberIsFinite(value) { return __velarNumberCall(__velarNumberNativeIsFinite, __velarNumberNativeNumber, [__velarNumberValue(value)]); }
`.trimStart();
