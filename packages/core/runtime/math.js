const __velarMathNativeMath = globalThis.Math;
const __velarMathNativeNumber = globalThis.Number;
const __velarMathNativeTypeError = globalThis.TypeError;
const __velarMathNativeRangeError = globalThis.RangeError;
const __velarMathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarMathApply = __velarMathGetOwnPropertyDescriptor(Reflect, "apply")?.value;
function __velarMathHostData(owner, key, kind) {
  const descriptor = __velarMathGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarMathNativeTypeError("The JavaScript " + key + " math API is unavailable");
  return descriptor.value;
}
function __velarMathHostOperation(owner, key) { return __velarMathHostData(owner, key, "function"); }
const __velarMathMin = __velarMathHostOperation(__velarMathNativeMath, "min");
const __velarMathMax = __velarMathHostOperation(__velarMathNativeMath, "max");
const __velarMathSqrt = __velarMathHostOperation(__velarMathNativeMath, "sqrt");
const __velarMathCbrt = __velarMathHostOperation(__velarMathNativeMath, "cbrt");
const __velarMathPow = __velarMathHostOperation(__velarMathNativeMath, "pow");
const __velarMathExp = __velarMathHostOperation(__velarMathNativeMath, "exp");
const __velarMathLog = __velarMathHostOperation(__velarMathNativeMath, "log");
const __velarMathLog2 = __velarMathHostOperation(__velarMathNativeMath, "log2");
const __velarMathLog10 = __velarMathHostOperation(__velarMathNativeMath, "log10");
const __velarMathSin = __velarMathHostOperation(__velarMathNativeMath, "sin");
const __velarMathCos = __velarMathHostOperation(__velarMathNativeMath, "cos");
const __velarMathTan = __velarMathHostOperation(__velarMathNativeMath, "tan");
const __velarMathAsin = __velarMathHostOperation(__velarMathNativeMath, "asin");
const __velarMathAcos = __velarMathHostOperation(__velarMathNativeMath, "acos");
const __velarMathAtan = __velarMathHostOperation(__velarMathNativeMath, "atan");
const __velarMathAtan2 = __velarMathHostOperation(__velarMathNativeMath, "atan2");
const __velarMathHypot = __velarMathHostOperation(__velarMathNativeMath, "hypot");
const __velarMathRandom = __velarMathHostOperation(__velarMathNativeMath, "random");
const __velarMathFloor = __velarMathHostOperation(__velarMathNativeMath, "floor");
const __velarMathAbs = __velarMathHostOperation(__velarMathNativeMath, "abs");
const __velarMathNumberIsFinite = __velarMathHostOperation(__velarMathNativeNumber, "isFinite");
const __velarMathNumberIsInteger = __velarMathHostOperation(__velarMathNativeNumber, "isInteger");
const __velarMathNumberIsSafeInteger = __velarMathHostOperation(__velarMathNativeNumber, "isSafeInteger");
if (typeof __velarMathApply !== "function") throw new __velarMathNativeTypeError("The JavaScript Reflect.apply math API is unavailable");
function __velarMathCall(operation, arguments_) { return __velarMathApply(operation, undefined, arguments_); }
function requireNumber(value, name) { if (typeof value !== "number") throw new __velarMathNativeTypeError(name + " requires numbers"); return value; }
// R1: a NaN may be held and tested with .isNaN(), but nothing compares or
// aggregates it. The self-inequality test cannot be redirected by a host.
function requireOrderedNumber(value, name) { requireNumber(value, name); if (value !== value) throw new __velarMathNativeTypeError(name + " found NaN, which has no ordering; drop it with filter(x => not x.isNaN()) or fix the upstream computation"); return value; }
function unary(value, operation, name) { return __velarMathCall(operation, [requireNumber(value, name)]); }
function binary(left, right, operation, name) { return __velarMathCall(operation, [requireNumber(left, name), requireNumber(right, name)]); }
export const pi = __velarMathHostData(__velarMathNativeMath, "PI", "number");
export const e = __velarMathHostData(__velarMathNativeMath, "E", "number");
export const tau = pi * 2;
export const infinity = __velarMathHostData(__velarMathNativeNumber, "POSITIVE_INFINITY", "number");
export function min(...values) { if (!values.length) throw new __velarMathNativeRangeError("min requires at least one number"); let result = requireOrderedNumber(values[0], "Math.min"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMin, [result, requireOrderedNumber(values[index], "Math.min")]); return result; }
export function max(...values) { if (!values.length) throw new __velarMathNativeRangeError("max requires at least one number"); let result = requireOrderedNumber(values[0], "Math.max"); for (let index = 1; index < values.length; index += 1) result = __velarMathCall(__velarMathMax, [result, requireOrderedNumber(values[index], "Math.max")]); return result; }
export function clamp(value, minimum, maximum) { value = requireOrderedNumber(value, "Math.clamp"); minimum = requireOrderedNumber(minimum, "Math.clamp"); maximum = requireOrderedNumber(maximum, "Math.clamp"); if (minimum > maximum) throw new __velarMathNativeRangeError("clamp minimum cannot exceed maximum"); return __velarMathCall(__velarMathMin, [maximum, __velarMathCall(__velarMathMax, [minimum, value])]); }
export function sqrt(value) { return unary(value, __velarMathSqrt, "sqrt"); }
export function cbrt(value) { return unary(value, __velarMathCbrt, "cbrt"); }
export function pow(left, right) { return binary(left, right, __velarMathPow, "pow"); }
export function exp(value) { return unary(value, __velarMathExp, "exp"); }
export function log(value, base = e) { return unary(value, __velarMathLog, "log") / unary(base, __velarMathLog, "log"); }
export function log2(value) { return unary(value, __velarMathLog2, "log2"); }
export function log10(value) { return unary(value, __velarMathLog10, "log10"); }
export function sin(value) { return unary(value, __velarMathSin, "sin"); }
export function cos(value) { return unary(value, __velarMathCos, "cos"); }
export function tan(value) { return unary(value, __velarMathTan, "tan"); }
export function asin(value) { return unary(value, __velarMathAsin, "asin"); }
export function acos(value) { return unary(value, __velarMathAcos, "acos"); }
export function atan(value) { return unary(value, __velarMathAtan, "atan"); }
export function atan2(left, right) { return binary(left, right, __velarMathAtan2, "atan2"); }
export function degrees(value) { return requireNumber(value, "degrees") * 180 / pi; }
export function radians(value) { return requireNumber(value, "radians") * pi / 180; }
export function hypot(left, right) { return binary(left, right, __velarMathHypot, "hypot"); }
export function random() { const value = __velarMathCall(__velarMathRandom, []); if (typeof value !== "number" || !__velarMathCall(__velarMathNumberIsFinite, [value])) throw new __velarMathNativeTypeError("The host random source must return a finite number"); if (value < 0 || value >= 1) throw new __velarMathNativeRangeError("The host random source must return a number from 0 up to but excluding 1"); return value; }
export function randomInt(minimum, maximum = null) { if (maximum === null) { maximum = minimum; minimum = 0; } const width = maximum - minimum; if (!__velarMathCall(__velarMathNumberIsSafeInteger, [minimum]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [maximum]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [width]) || width <= 0) throw new __velarMathNativeRangeError("randomInt requires an increasing safe-integer range"); return __velarMathCall(__velarMathFloor, [random() * width]) + minimum; }
export function gcd(left, right) { if (!__velarMathCall(__velarMathNumberIsSafeInteger, [left]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [right])) throw new __velarMathNativeTypeError("gcd requires safe integers"); left = __velarMathCall(__velarMathAbs, [left]); right = __velarMathCall(__velarMathAbs, [right]); while (right) [left, right] = [right, left % right]; return left; }
export function lcm(left, right) { if (!__velarMathCall(__velarMathNumberIsSafeInteger, [left]) || !__velarMathCall(__velarMathNumberIsSafeInteger, [right])) throw new __velarMathNativeTypeError("lcm requires safe integers"); if (left === 0 || right === 0) return 0; const result = __velarMathCall(__velarMathAbs, [(left / gcd(left, right)) * right]); if (!__velarMathCall(__velarMathNumberIsSafeInteger, [result])) throw new __velarMathNativeRangeError("lcm result is outside the safe-integer range"); return result; }
