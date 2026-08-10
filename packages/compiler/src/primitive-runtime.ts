import { VELAR_NUMBER_METHOD_RUNTIME } from "./number-runtime.ts";
import { VELAR_TEXT_METHOD_RUNTIME } from "./text-runtime.ts";

export const VELAR_PRIMITIVE_METHOD_MODULE = "velar/compiler-runtime-primitives-v1";

/** Project-shared implementation of compiler-lowered String and Number receiver methods. */
export const VELAR_PRIMITIVE_METHOD_MODULE_SOURCE = String.raw`
${VELAR_TEXT_METHOD_RUNTIME}
${VELAR_NUMBER_METHOD_RUNTIME}
export {
  __velarStringSize as stringSize,
  __velarStringTrim as stringTrim,
  __velarStringUpper as stringUpper,
  __velarStringLower as stringLower,
  __velarStringSlice as stringSlice,
  __velarStringChar as stringChar,
  __velarStringHas as stringHas,
  __velarStringIndex as stringIndex,
  __velarStringCount as stringCount,
  __velarStringStartsWith as stringStartsWith,
  __velarStringEndsWith as stringEndsWith,
  __velarStringSplit as stringSplit,
  __velarStringReplace as stringReplace,
  __velarStringReplaceAll as stringReplaceAll,
  __velarStringPadStart as stringPadStart,
  __velarStringPadEnd as stringPadEnd,
  __velarStringRepeat as stringRepeat,
  __velarNumberAbs as numberAbs,
  __velarNumberRound as numberRound,
  __velarNumberFloor as numberFloor,
  __velarNumberCeil as numberCeil,
  __velarNumberToFixed as numberToFixed,
};
`.trimStart();
