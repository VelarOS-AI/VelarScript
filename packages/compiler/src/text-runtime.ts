export const VELAR_TEXT_METHOD_RUNTIME = String.raw`
const __velarMaxTextCodeUnits = 16 * 1024 * 1024;
const __velarMaxTextItems = 1000000;
const __velarTextNativeArray = globalThis.Array;
const __velarTextNativeString = globalThis.String;
const __velarTextNativeNumber = globalThis.Number;
const __velarTextNativeMath = globalThis.Math;
const __velarTextNativeObject = globalThis.Object;
const __velarTextNativeTypeError = globalThis.TypeError;
const __velarTextNativeRangeError = globalThis.RangeError;
const __velarTextGetOwnPropertyDescriptor = __velarTextNativeObject.getOwnPropertyDescriptor;
const __velarTextRuntimeGetPrototypeOf = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getPrototypeOf")?.value;
const __velarTextReflectApply = __velarTextGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarTextStringPrototype = __velarTextGetOwnPropertyDescriptor(__velarTextNativeString, "prototype")?.value;
const __velarTextArrayIsArray = __velarTextGetOwnPropertyDescriptor(__velarTextNativeArray, "isArray")?.value;
const __velarTextNumberIsSafeInteger = __velarTextGetOwnPropertyDescriptor(__velarTextNativeNumber, "isSafeInteger")?.value;
const __velarTextNumberIsInteger = __velarTextGetOwnPropertyDescriptor(__velarTextNativeNumber, "isInteger")?.value;
const __velarTextMathFloor = __velarTextGetOwnPropertyDescriptor(__velarTextNativeMath, "floor")?.value;
const __velarTextMathMax = __velarTextGetOwnPropertyDescriptor(__velarTextNativeMath, "max")?.value;
const __velarTextMathMin = __velarTextGetOwnPropertyDescriptor(__velarTextNativeMath, "min")?.value;
const __velarNativeStringIndexOf = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "indexOf")?.value;
const __velarNativeStringSlice = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "slice")?.value;
const __velarNativeStringCharCodeAt = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "charCodeAt")?.value;
const __velarNativeStringTrim = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "trim")?.value;
const __velarNativeStringUpper = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "toUpperCase")?.value;
const __velarNativeStringLower = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "toLowerCase")?.value;
const __velarNativeStringSplit = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "split")?.value;
const __velarNativeStringReplace = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "replace")?.value;
const __velarNativeStringReplaceAll = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "replaceAll")?.value;
const __velarNativeStringRepeat = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "repeat")?.value;
const __velarTextSurrogatePattern = /[\u{10000}-\u{10FFFF}\uD800-\uDFFF]/u;
const __velarTextRegExpPrototype = typeof __velarTextRuntimeGetPrototypeOf === "function" ? __velarTextRuntimeGetPrototypeOf(__velarTextSurrogatePattern) : null;
const __velarTextSurrogateExec = __velarTextRegExpPrototype ? __velarTextGetOwnPropertyDescriptor(__velarTextRegExpPrototype, "exec")?.value : null;
function __velarTextCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarTextReflectApply !== "function") throw new __velarTextNativeTypeError("The JavaScript text runtime is unavailable");
  return __velarTextReflectApply(operation, receiver, arguments_);
}

function __velarTextValue(value) {
  if (typeof value !== "string") throw new __velarTextNativeTypeError("String methods require a string receiver");
  if (value.length > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError("Strings cannot exceed 16 MiB");
  return value;
}
function __velarTextArgument(value, name) {
  if (typeof value !== "string") throw new __velarTextNativeTypeError(name + " must be a string");
  if (value.length > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError(name + " cannot exceed 16 MiB");
  return value;
}
function __velarTextOutput(value, name) {
  if (value.length > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError(name + " output cannot exceed 16 MiB");
  return value;
}
function __velarTextCount(value, name) {
  if (!__velarTextCall(__velarTextNumberIsSafeInteger, __velarTextNativeNumber, [value]) || value < 0 || value > __velarMaxTextCodeUnits) {
    throw new __velarTextNativeRangeError(name + " must be an integer from 0 through " + __velarMaxTextCodeUnits);
  }
  return value;
}
function __velarTextList(values, name) {
  if (values.length > __velarMaxTextItems) throw new __velarTextNativeRangeError(name + " cannot produce more than " + __velarMaxTextItems + " items");
  return values;
}
function __velarTextNextCodePointOffset(value, offset) {
  const first = __velarTextCall(__velarNativeStringCharCodeAt, value, [offset]);
  if (first < 0xD800 || first > 0xDBFF || offset + 1 >= value.length) return offset + 1;
  const second = __velarTextCall(__velarNativeStringCharCodeAt, value, [offset + 1]);
  return second >= 0xDC00 && second <= 0xDFFF ? offset + 2 : offset + 1;
}
function __velarTextCodePointLength(value) {
  if (__velarTextCall(__velarTextSurrogateExec, __velarTextSurrogatePattern, [value]) === null) return value.length;
  let length = 0, offset = 0;
  while (offset < value.length) { offset = __velarTextNextCodePointOffset(value, offset); length += 1; }
  return length;
}
function __velarTextCodePointPrefix(value, count) { return __velarTextCall(__velarNativeStringSlice, value, [0, __velarTextCodeUnitOffset(value, count)]); }
function __velarTextCodeUnitOffset(value, position) {
  let offset = 0, current = 0;
  while (offset < value.length && current < position) { offset = __velarTextNextCodePointOffset(value, offset); current += 1; }
  return offset;
}
function __velarTextCodePointIndex(value, unitOffset) {
  let offset = 0, position = 0;
  while (offset < unitOffset && offset < value.length) { offset = __velarTextNextCodePointOffset(value, offset); position += 1; }
  return offset === unitOffset ? position : null;
}
function __velarTextCodePointDistance(value, start, end) {
  let offset = start, distance = 0;
  while (offset < end) { offset = __velarTextNextCodePointOffset(value, offset); distance += 1; }
  return offset === end ? distance : null;
}
function __velarTextReplacementOutputUnits(value, search, replacement, all) {
  let matches = 0;
  if (search === "") matches = all ? __velarTextCodePointLength(value) + 1 : 1;
  else {
    let cursor = 0;
    while (true) {
      const index = __velarTextCall(__velarNativeStringIndexOf, value, [search, cursor]);
      if (index < 0) break;
      matches += 1;
      if (!all) break;
      cursor = index + search.length;
    }
  }
  if (replacement.length <= search.length || matches === 0) return value.length;
  const growth = replacement.length - search.length;
  if (matches > __velarTextCall(__velarTextMathFloor, __velarTextNativeMath, [(__velarMaxTextCodeUnits - value.length) / growth])) return __velarMaxTextCodeUnits + 1;
  return value.length + matches * growth;
}

function __velarStringSize(value) { return __velarTextCodePointLength(__velarTextValue(value)); }
function __velarStringTrim(value) { return __velarTextCall(__velarNativeStringTrim, __velarTextValue(value), []); }
function __velarStringIsBlank(value) { return __velarTextCall(__velarNativeStringTrim, __velarTextValue(value), []) === ""; }
function __velarStringUpper(value) { return __velarTextOutput(__velarTextCall(__velarNativeStringUpper, __velarTextValue(value), []), "String.upper"); }
function __velarStringLower(value) { return __velarTextOutput(__velarTextCall(__velarNativeStringLower, __velarTextValue(value), []), "String.lower"); }
function __velarStringSlice(value, start = 0, end = null) {
  value = __velarTextValue(value);
  const total = __velarTextCodePointLength(value);
  if (end === null) end = total;
  if (!__velarTextCall(__velarTextNumberIsInteger, __velarTextNativeNumber, [start]) || !__velarTextCall(__velarTextNumberIsInteger, __velarTextNativeNumber, [end])) throw new __velarTextNativeTypeError("String.slice positions must be integers");
  const first = start < 0 ? __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [total + start, 0]) : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [start, total]);
  const last = end < 0 ? __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [total + end, 0]) : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [end, total]);
  return __velarTextCall(__velarNativeStringSlice, value, [__velarTextCodeUnitOffset(value, first), __velarTextCodeUnitOffset(value, last)]);
}
function __velarStringChar(value, index) {
  value = __velarTextValue(value);
  if (!__velarTextCall(__velarTextNumberIsInteger, __velarTextNativeNumber, [index])) throw new __velarTextNativeTypeError("String.char index must be an integer");
  const total = __velarTextCodePointLength(value);
  if (index < 0) index += total;
  if (index < 0) return null;
  if (index >= total) return null;
  const start = __velarTextCodeUnitOffset(value, index);
  return __velarTextCall(__velarNativeStringSlice, value, [start, __velarTextNextCodePointOffset(value, start)]);
}
function __velarStringHas(value, text) { return __velarTextCall(__velarNativeStringIndexOf, __velarTextValue(value), [__velarTextArgument(text, "String.has text")]) >= 0; }
function __velarStringIndex(value, text, start = 0) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.index text");
  if (!__velarTextCall(__velarTextNumberIsInteger, __velarTextNativeNumber, [start])) throw new __velarTextNativeTypeError("String.index start must be an integer");
  const total = __velarTextCodePointLength(value);
  const first = start < 0 ? __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [total + start, 0]) : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [start, total]);
  let cursor = __velarTextCodeUnitOffset(value, first);
  if (text === "") return first;
  while (cursor <= value.length) {
    const found = __velarTextCall(__velarNativeStringIndexOf, value, [text, cursor]);
    if (found < 0) return null;
    const position = __velarTextCodePointIndex(value, found);
    if (position !== null && __velarTextCodePointIndex(value, found + text.length) !== null) return position;
    cursor = found + 1;
  }
  return null;
}
function __velarStringCount(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.count text");
  if (text === "") return __velarTextCodePointLength(value) + 1;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = __velarTextCall(__velarNativeStringIndexOf, value, [text, cursor]);
    if (index < 0) return count;
    count += 1;
    cursor = index + text.length;
  }
}
function __velarStringStartsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.startsWith text");
  return __velarTextCall(__velarNativeStringIndexOf, value, [text, 0]) === 0;
}
function __velarStringEndsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.endsWith text");
  const start = value.length - text.length;
  return start >= 0 && __velarTextCall(__velarNativeStringIndexOf, value, [text, start]) === start;
}
function __velarStringSplit(value, separator) {
  value = __velarTextValue(value); separator = __velarTextArgument(separator, "String.split separator");
  if (separator === "") {
    const count = __velarTextCodePointLength(value);
    if (count > __velarMaxTextItems) throw new __velarTextNativeRangeError("String.split cannot produce more than " + __velarMaxTextItems + " items");
    const output = new __velarTextNativeArray(count);
    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      const next = __velarTextNextCodePointOffset(value, offset);
      output[index] = __velarTextCall(__velarNativeStringSlice, value, [offset, next]);
      offset = next;
    }
    return output;
  }
  return __velarTextList(__velarTextCall(__velarNativeStringSplit, value, [separator, __velarMaxTextItems + 1]), "String.split");
}
function __velarStringReplace(value, from, to) {
  value = __velarTextValue(value); from = __velarTextArgument(from, "String.replace from"); to = __velarTextArgument(to, "String.replace to");
  if (__velarTextReplacementOutputUnits(value, from, to, false) > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError("String.replace output cannot exceed 16 MiB");
  return __velarTextCall(__velarNativeStringReplace, value, [from, () => to]);
}
function __velarStringReplaceAll(value, from, to) {
  value = __velarTextValue(value); from = __velarTextArgument(from, "String.replaceAll from"); to = __velarTextArgument(to, "String.replaceAll to");
  if (__velarTextReplacementOutputUnits(value, from, to, true) > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError("String.replaceAll output cannot exceed 16 MiB");
  if (from === "") {
    let output = to;
    let offset = 0;
    while (offset < value.length) { const next = __velarTextNextCodePointOffset(value, offset); output += __velarTextCall(__velarNativeStringSlice, value, [offset, next]) + to; offset = next; }
    return output;
  }
  return __velarTextCall(__velarNativeStringReplaceAll, value, [from, () => to]);
}
function __velarStringPad(value, size, fill, start) {
  const name = start ? "String.padStart" : "String.padEnd";
  value = __velarTextValue(value); size = __velarTextCount(size, name + " size"); fill = __velarTextArgument(fill, name + " fill");
  const needed = size - __velarTextCodePointLength(value);
  if (needed <= 0 || fill.length === 0) return value;
  let outputUnits = value.length;
  let padding = "";
  let counted = 0, fillOffset = 0;
  while (counted < needed) {
    const next = __velarTextNextCodePointOffset(fill, fillOffset);
    const character = __velarTextCall(__velarNativeStringSlice, fill, [fillOffset, next]);
    outputUnits += character.length;
    if (outputUnits > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError(name + " output cannot exceed 16 MiB");
    padding += character;
    counted += 1;
    fillOffset = next === fill.length ? 0 : next;
  }
  return start ? padding + value : value + padding;
}
function __velarStringPadStart(value, size, fill = " ") { return __velarStringPad(value, size, fill, true); }
function __velarStringPadEnd(value, size, fill = " ") { return __velarStringPad(value, size, fill, false); }
function __velarStringRepeat(value, count) {
  value = __velarTextValue(value); count = __velarTextCount(count, "String.repeat count");
  if (value.length > 0 && count > __velarTextCall(__velarTextMathFloor, __velarTextNativeMath, [__velarMaxTextCodeUnits / value.length])) throw new __velarTextNativeRangeError("String.repeat output cannot exceed 16 MiB");
  return __velarTextCall(__velarNativeStringRepeat, value, [count]);
}
`.trimStart();
