export const VELAR_TEXT_METHOD_RUNTIME = String.raw`
const __velarMaxTextCodeUnits = 16 * 1024 * 1024;
const __velarMaxTextItems = 1000000;
const __velarNativeStringIndexOf = Object.getOwnPropertyDescriptor(String.prototype, "indexOf").value;
const __velarNativeStringTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim").value;
const __velarNativeStringUpper = Object.getOwnPropertyDescriptor(String.prototype, "toUpperCase").value;
const __velarNativeStringLower = Object.getOwnPropertyDescriptor(String.prototype, "toLowerCase").value;
const __velarNativeStringSplit = Object.getOwnPropertyDescriptor(String.prototype, "split").value;
const __velarNativeStringReplace = Object.getOwnPropertyDescriptor(String.prototype, "replace").value;
const __velarNativeStringReplaceAll = Object.getOwnPropertyDescriptor(String.prototype, "replaceAll").value;
const __velarNativeStringPadStart = Object.getOwnPropertyDescriptor(String.prototype, "padStart").value;
const __velarNativeStringPadEnd = Object.getOwnPropertyDescriptor(String.prototype, "padEnd").value;
const __velarNativeStringRepeat = Object.getOwnPropertyDescriptor(String.prototype, "repeat").value;

function __velarTextValue(value) {
  if (typeof value !== "string") throw new TypeError("String methods require a string receiver");
  if (value.length > __velarMaxTextCodeUnits) throw new RangeError("Strings cannot exceed 16 MiB");
  return value;
}
function __velarTextArgument(value, name) {
  if (typeof value !== "string") throw new TypeError(name + " must be a string");
  if (value.length > __velarMaxTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function __velarTextOutput(value, name) {
  if (value.length > __velarMaxTextCodeUnits) throw new RangeError(name + " output cannot exceed 16 MiB");
  return value;
}
function __velarTextCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > __velarMaxTextCodeUnits) {
    throw new RangeError(name + " must be an integer from 0 through " + __velarMaxTextCodeUnits);
  }
  return value;
}
function __velarTextList(values, name) {
  if (values.length > __velarMaxTextItems) throw new RangeError(name + " cannot produce more than " + __velarMaxTextItems + " items");
  return values;
}
function __velarTextCodePointLength(value) { let length = 0; for (const _ of value) length += 1; return length; }
function __velarTextCodePointPrefix(value, count) { let output = "", length = 0; for (const character of value) { if (length >= count) break; output += character; length += 1; } return output; }
function __velarTextReplacementOutputUnits(value, search, replacement, all) {
  let matches = 0;
  if (search === "") matches = all ? value.length + 1 : 1;
  else {
    let cursor = 0;
    while (true) {
      const index = __velarNativeStringIndexOf.call(value, search, cursor);
      if (index < 0) break;
      matches += 1;
      if (!all) break;
      cursor = index + search.length;
    }
  }
  if (replacement.length <= search.length || matches === 0) return value.length;
  const growth = replacement.length - search.length;
  if (matches > Math.floor((__velarMaxTextCodeUnits - value.length) / growth)) return __velarMaxTextCodeUnits + 1;
  return value.length + matches * growth;
}

function __velarStringSize(value) { return __velarTextCodePointLength(__velarTextValue(value)); }
function __velarStringTrim(value) { return __velarNativeStringTrim.call(__velarTextValue(value)); }
function __velarStringUpper(value) { return __velarTextOutput(__velarNativeStringUpper.call(__velarTextValue(value)), "String.upper"); }
function __velarStringLower(value) { return __velarTextOutput(__velarNativeStringLower.call(__velarTextValue(value)), "String.lower"); }
function __velarStringSlice(value, start = 0, end = null) {
  value = __velarTextValue(value);
  const total = __velarTextCodePointLength(value);
  if (end === null) end = total;
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new TypeError("String.slice positions must be integers");
  const first = start < 0 ? Math.max(total + start, 0) : Math.min(start, total);
  const last = end < 0 ? Math.max(total + end, 0) : Math.min(end, total);
  let output = "";
  let position = 0;
  for (const character of value) {
    if (position >= last) break;
    if (position >= first) output += character;
    position += 1;
  }
  return output;
}
function __velarStringChar(value, index) {
  value = __velarTextValue(value);
  if (!Number.isInteger(index)) return null;
  if (index < 0) index += __velarTextCodePointLength(value);
  if (index < 0) return null;
  let position = 0;
  for (const character of value) { if (position === index) return character; position += 1; }
  return null;
}
function __velarStringHas(value, text) { return __velarNativeStringIndexOf.call(__velarTextValue(value), __velarTextArgument(text, "String.has text")) >= 0; }
function __velarStringStartsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.startsWith text");
  return __velarNativeStringIndexOf.call(value, text, 0) === 0;
}
function __velarStringEndsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.endsWith text");
  const start = value.length - text.length;
  return start >= 0 && __velarNativeStringIndexOf.call(value, text, start) === start;
}
function __velarStringSplit(value, separator) {
  value = __velarTextValue(value); separator = __velarTextArgument(separator, "String.split separator");
  if (separator === "" && value.length > __velarMaxTextItems) throw new RangeError("String.split cannot produce more than " + __velarMaxTextItems + " items");
  return __velarTextList(__velarNativeStringSplit.call(value, separator, __velarMaxTextItems + 1), "String.split");
}
function __velarStringReplace(value, from, to) {
  value = __velarTextValue(value); from = __velarTextArgument(from, "String.replace from"); to = __velarTextArgument(to, "String.replace to");
  if (__velarTextReplacementOutputUnits(value, from, to, false) > __velarMaxTextCodeUnits) throw new RangeError("String.replace output cannot exceed 16 MiB");
  return __velarNativeStringReplace.call(value, from, to);
}
function __velarStringReplaceAll(value, from, to) {
  value = __velarTextValue(value); from = __velarTextArgument(from, "String.replaceAll from"); to = __velarTextArgument(to, "String.replaceAll to");
  if (__velarTextReplacementOutputUnits(value, from, to, true) > __velarMaxTextCodeUnits) throw new RangeError("String.replaceAll output cannot exceed 16 MiB");
  return __velarNativeStringReplaceAll.call(value, from, to);
}
function __velarStringPadStart(value, size, fill = " ") { return __velarNativeStringPadStart.call(__velarTextValue(value), __velarTextCount(size, "String.padStart size"), __velarTextArgument(fill, "String.padStart fill")); }
function __velarStringPadEnd(value, size, fill = " ") { return __velarNativeStringPadEnd.call(__velarTextValue(value), __velarTextCount(size, "String.padEnd size"), __velarTextArgument(fill, "String.padEnd fill")); }
function __velarStringRepeat(value, count) {
  value = __velarTextValue(value); count = __velarTextCount(count, "String.repeat count");
  if (value.length > 0 && count > Math.floor(__velarMaxTextCodeUnits / value.length)) throw new RangeError("String.repeat output cannot exceed 16 MiB");
  return __velarNativeStringRepeat.call(value, count);
}
`.trimStart();
