export const VELAR_RANGE_MODULE = "velar/compiler-runtime-range-v1";

/**
 * D114 S3: the prelude `range` and its counted-loop owner. Both used to live in
 * `velar/collections`; that module retired when its twelve List duplicates
 * became members, and `range` is the one name it published that was never a
 * List operation, so it moves to a compiler-owned runtime module rather than
 * keeping a public module alive for one function.
 *
 * D97: the counted form validates the whole range before the emitted loop body
 * runs, in constant time for finite safe-integer bounds, and hands back three
 * scalars that generated code unpacks immediately — never a List.
 */
export const VELAR_RANGE_RUNTIME = String.raw`
const __velarRangeMaxItems = 1000000;
const __velarRangeNativeArray = globalThis.Array;
const __velarRangeNativeNumber = globalThis.Number;
const __velarRangeNativeMath = globalThis.Math;
const __velarRangeNativeObject = globalThis.Object;
const __velarRangeNativeTypeError = globalThis.TypeError;
const __velarRangeNativeRangeError = globalThis.RangeError;
const __velarRangeGetOwnPropertyDescriptor = __velarRangeNativeObject.getOwnPropertyDescriptor;
const __velarRangeReflectApply = __velarRangeGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
function __velarRangeHostOperation(owner, key) {
  const descriptor = __velarRangeGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarRangeNativeTypeError("The JavaScript " + key + " numeric API is unavailable");
  return descriptor.value;
}
const __velarRangeNumberIsFinite = __velarRangeHostOperation(__velarRangeNativeNumber, "isFinite");
const __velarRangeNumberIsSafeInteger = __velarRangeHostOperation(__velarRangeNativeNumber, "isSafeInteger");
const __velarRangeMathFloor = __velarRangeHostOperation(__velarRangeNativeMath, "floor");
const __velarRangeObjectDefineProperty = __velarRangeHostOperation(__velarRangeNativeObject, "defineProperty");
if (typeof __velarRangeReflectApply !== "function") throw new __velarRangeNativeTypeError("The JavaScript Reflect.apply numeric API is unavailable");
function __velarRangeCall(operation, receiver, arguments_) { return __velarRangeReflectApply(operation, receiver, arguments_); }
function __velarRangeBounds(start, stop, step) {
  if (!__velarRangeCall(__velarRangeNumberIsFinite, __velarRangeNativeNumber, [start]) || !__velarRangeCall(__velarRangeNumberIsFinite, __velarRangeNativeNumber, [stop]) || !__velarRangeCall(__velarRangeNumberIsFinite, __velarRangeNativeNumber, [step]) || step === 0) throw new __velarRangeNativeRangeError("range requires finite numbers and a non-zero step");
}
function __velarRange(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  __velarRangeBounds(start, stop, step);
  const output = new __velarRangeNativeArray();
  if (step > 0) for (let value = start; value < stop;) {
    if (output.length >= __velarRangeMaxItems) throw new __velarRangeNativeRangeError("range cannot produce more than " + __velarRangeMaxItems + " items");
    output[output.length] = value; const next = value + step;
    if (next === value) throw new __velarRangeNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (output.length >= __velarRangeMaxItems) throw new __velarRangeNativeRangeError("range cannot produce more than " + __velarRangeMaxItems + " items");
    output[output.length] = value; const next = value + step;
    if (next === value) throw new __velarRangeNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  return output;
}
// Compiler-only entry point for a direct counted range loop. Validation
// deliberately completes before the loop body starts, matching range()'s
// eager errors without allocating the produced List.
function __velarCountedRange(start, stop = null, step = 1) {
  if (stop === null) { stop = start; start = 0; }
  __velarRangeBounds(start, stop, step);
  // World and binary workloads use many small integer ranges. Their iteration
  // count is exact arithmetic, so validate the million-item bound in constant
  // time instead of replaying the complete counter before the emitted loop.
  // Floating-point and very large ranges retain the step-by-step path below,
  // including its exact non-advancing-number behaviour.
  if (__velarRangeCall(__velarRangeNumberIsSafeInteger, __velarRangeNativeNumber, [start])
    && __velarRangeCall(__velarRangeNumberIsSafeInteger, __velarRangeNativeNumber, [stop])
    && __velarRangeCall(__velarRangeNumberIsSafeInteger, __velarRangeNativeNumber, [step])) {
    const distance = step > 0 ? stop - start : start - stop;
    if (distance <= 0) return [start, stop, step];
    if (__velarRangeCall(__velarRangeNumberIsSafeInteger, __velarRangeNativeNumber, [distance])) {
      const magnitude = step > 0 ? step : -step;
      const count = __velarRangeCall(__velarRangeMathFloor, __velarRangeNativeMath, [(distance - 1) / magnitude]) + 1;
      if (count > __velarRangeMaxItems) throw new __velarRangeNativeRangeError("range cannot produce more than " + __velarRangeMaxItems + " items");
      return [start, stop, step];
    }
  }
  let count = 0;
  if (step > 0) for (let value = start; value < stop;) {
    if (count >= __velarRangeMaxItems) throw new __velarRangeNativeRangeError("range cannot produce more than " + __velarRangeMaxItems + " items");
    count += 1; const next = value + step;
    if (next === value) throw new __velarRangeNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  } else for (let value = start; value > stop;) {
    if (count >= __velarRangeMaxItems) throw new __velarRangeNativeRangeError("range cannot produce more than " + __velarRangeMaxItems + " items");
    count += 1; const next = value + step;
    if (next === value) throw new __velarRangeNativeRangeError("range step is too small to advance at this magnitude");
    value = next;
  }
  // The tuple is a compiler-private handoff consumed immediately by generated
  // scalar locals. It never reaches VelarScript code, so freezing it only adds
  // allocation work to every nested counter loop without strengthening a
  // source-visible boundary.
  return [start, stop, step];
}
__velarRangeCall(__velarRangeObjectDefineProperty, __velarRangeNativeObject, [__velarRange, "__velarCounted", {
  value: __velarCountedRange,
  enumerable: false,
  configurable: false,
  writable: false,
}]);
`.trimStart();

export const VELAR_RANGE_MODULE_SOURCE = String.raw`
${VELAR_RANGE_RUNTIME}
export {
  __velarRange as range,
};
`.trimStart();
