export const VELAR_TEXT_METHOD_RUNTIME = String.raw`
const __velarMaxTextCodeUnits = 16 * 1024 * 1024;
const __velarMaxTextItems = 1000000;
const __velarTextNativeArray = globalThis.Array;
const __velarTextNativeString = globalThis.String;
const __velarTextNativeNumber = globalThis.Number;
const __velarTextNativeMath = globalThis.Math;
const __velarTextNativeObject = globalThis.Object;
const __velarTextNativeMap = globalThis.Map;
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
const __velarNativeStringReplaceAll = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "replaceAll")?.value;
const __velarNativeStringRepeat = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "repeat")?.value;
const __velarTextMapPrototype = typeof __velarTextNativeMap === "function" ? __velarTextGetOwnPropertyDescriptor(__velarTextNativeMap, "prototype")?.value : null;
const __velarTextMapGet = __velarTextMapPrototype ? __velarTextGetOwnPropertyDescriptor(__velarTextMapPrototype, "get")?.value : null;
const __velarTextMapSet = __velarTextMapPrototype ? __velarTextGetOwnPropertyDescriptor(__velarTextMapPrototype, "set")?.value : null;
const __velarTextMapClear = __velarTextMapPrototype ? __velarTextGetOwnPropertyDescriptor(__velarTextMapPrototype, "clear")?.value : null;
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
// D90 R7, performance half. Measuring a string used to be a whole-string job
// every single time: the surrogate probe ran per call, and one astral character
// anywhere forced every offset conversion to walk code points from zero, which
// made a loop of char/slice calls quadratic: 20,000 char/slice calls over a
// 200 KiB string with one leading astral character took 17.1 s, and 34 ms
// once measurement was memoised. A measurement is a pure function of an
// immutable value, so it is memoised: a dense string answers offset conversions in
// O(1) when no surrogate pair splits it, and otherwise the checkpoint list
// records the code-unit offset of every stride-th code point so a conversion
// starts from the nearest checkpoint instead of from the start of the string.
// The cache may only change the cost of an answer, never the answer.
const __velarTextCheckpointStride = 64;
const __velarTextMeasureMinimumUnits = 64;
// The cache holds its keys strongly, so its budget is memory the program has
// stopped using but cannot reclaim. Eight MiB buys the loops that matter and
// bounds what a document-processing program leaves behind; a single string
// larger than the budget still measures once and stays, because evicting the
// string a loop is walking would put the cliff back. The entry count only
// bounds the cache's own bookkeeping, so it is set well above the number of
// strings a loop cycles through: a tighter count made a walk over 65 short
// strings 15x slower than the same walk over 64.
const __velarTextMeasureCacheEntries = 512;
const __velarTextMeasureCacheUnits = 8 * 1024 * 1024;
const __velarTextMeasureCache = typeof __velarTextNativeMap === "function"
  && typeof __velarTextMapGet === "function" && typeof __velarTextMapSet === "function" && typeof __velarTextMapClear === "function"
  ? new __velarTextNativeMap() : null;
let __velarTextMeasureCacheCount = 0;
let __velarTextMeasureCacheHeld = 0;
function __velarTextMeasureText(value) {
  if (__velarTextCall(__velarTextSurrogateExec, __velarTextSurrogatePattern, [value]) === null) {
    return { length: value.length, dense: true, checkpoints: null };
  }
  const checkpoints = new __velarTextNativeArray();
  let length = 0, offset = 0;
  while (offset < value.length) {
    if (length % __velarTextCheckpointStride === 0) checkpoints[length / __velarTextCheckpointStride] = offset;
    offset = __velarTextNextCodePointOffset(value, offset);
    length += 1;
  }
  // A string that carries only unpaired surrogates still has one unit per code
  // point, so it keeps the O(1) path even though the probe matched.
  return { length: length, dense: length === value.length, checkpoints: checkpoints };
}
function __velarTextMeasure(value) {
  if (__velarTextMeasureCache === null || value.length < __velarTextMeasureMinimumUnits) return __velarTextMeasureText(value);
  const cached = __velarTextCall(__velarTextMapGet, __velarTextMeasureCache, [value]);
  if (cached !== undefined) return cached;
  const measured = __velarTextMeasureText(value);
  if (__velarTextMeasureCacheCount >= __velarTextMeasureCacheEntries
    || (__velarTextMeasureCacheCount > 0 && __velarTextMeasureCacheHeld + value.length > __velarTextMeasureCacheUnits)) {
    __velarTextCall(__velarTextMapClear, __velarTextMeasureCache, []);
    __velarTextMeasureCacheCount = 0;
    __velarTextMeasureCacheHeld = 0;
  }
  __velarTextCall(__velarTextMapSet, __velarTextMeasureCache, [value, measured]);
  __velarTextMeasureCacheCount += 1;
  __velarTextMeasureCacheHeld += value.length;
  return measured;
}
function __velarTextCodePointLength(value) {
  return __velarTextMeasure(value).length;
}
function __velarTextCodePointPrefix(value, count) { return __velarTextCall(__velarNativeStringSlice, value, [0, __velarTextCodeUnitOffset(value, count)]); }
function __velarTextCodeUnitOffset(value, position) {
  const measured = __velarTextMeasure(value);
  if (measured.dense) return position < value.length ? position : value.length;
  if (position <= 0) return 0;
  const checkpoints = measured.checkpoints;
  let block = __velarTextCall(__velarTextMathFloor, __velarTextNativeMath, [position / __velarTextCheckpointStride]);
  if (block >= checkpoints.length) block = checkpoints.length - 1;
  let offset = checkpoints[block], current = block * __velarTextCheckpointStride;
  while (offset < value.length && current < position) { offset = __velarTextNextCodePointOffset(value, offset); current += 1; }
  return offset;
}
function __velarTextCodePointIndex(value, unitOffset) {
  const measured = __velarTextMeasure(value);
  if (measured.dense) return unitOffset <= value.length ? unitOffset : null;
  if (unitOffset < 0 || unitOffset > value.length) return null;
  const checkpoints = measured.checkpoints;
  let low = 0, high = checkpoints.length - 1;
  while (low < high) {
    const middle = low + __velarTextCall(__velarTextMathFloor, __velarTextNativeMath, [(high - low + 1) / 2]);
    if (checkpoints[middle] <= unitOffset) low = middle; else high = middle - 1;
  }
  let offset = checkpoints[low], position = low * __velarTextCheckpointStride;
  while (offset < unitOffset && offset < value.length) { offset = __velarTextNextCodePointOffset(value, offset); position += 1; }
  return offset === unitOffset ? position : null;
}
function __velarTextCodePointDistance(value, start, end) {
  if (__velarTextMeasure(value).dense) return end >= start ? end - start : null;
  let offset = start, distance = 0;
  while (offset < end) { offset = __velarTextNextCodePointOffset(value, offset); distance += 1; }
  return offset === end ? distance : null;
}
// D90 R7: a code-unit offset sits between two code points unless it splits a
// surrogate pair, and only an adjacent lead/trail pair can be split. The test
// is O(1), so every search below can reject a mid-pair hit without measuring
// the string.
function __velarTextIsBoundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const lead = __velarTextCall(__velarNativeStringCharCodeAt, value, [offset - 1]);
  if (lead < 0xD800 || lead > 0xDBFF) return true;
  const trail = __velarTextCall(__velarNativeStringCharCodeAt, value, [offset]);
  return trail < 0xDC00 || trail > 0xDFFF;
}
// D90 R7, performance half. A match can only start inside a pair when the
// needle starts with a trail surrogate, and can only end inside one when the
// needle ends with a lead surrogate: the unit the gate reads at each end of a
// match is the needle's own edge unit. Both are properties of the needle
// alone, so one O(1) look says whether the native scan already answers what
// the bounded scan answers, and an ordinary needle keeps native speed on any
// haystack. The needle must not be empty; each caller handles that case.
function __velarTextNeedsBoundaryCheck(search) {
  const first = __velarTextCall(__velarNativeStringCharCodeAt, search, [0]);
  if (first >= 0xDC00 && first <= 0xDFFF) return true;
  const last = __velarTextCall(__velarNativeStringCharCodeAt, search, [search.length - 1]);
  return last >= 0xD800 && last <= 0xDBFF;
}
// Every search operation goes through here so that a match is accepted only
// when it starts and ends on a code-point boundary. A needle that begins or
// ends with an unpaired surrogate therefore never matches inside a pair, which
// is what keeps split/replace/replaceAll from manufacturing lone surrogates.
// The needle must not be empty; each caller handles that case in its own voice.
function __velarTextBoundedIndexOf(value, search, cursor) {
  if (!__velarTextNeedsBoundaryCheck(search)) return __velarTextCall(__velarNativeStringIndexOf, value, [search, cursor]);
  while (cursor <= value.length) {
    const found = __velarTextCall(__velarNativeStringIndexOf, value, [search, cursor]);
    if (found < 0) return -1;
    if (__velarTextIsBoundary(value, found) && __velarTextIsBoundary(value, found + search.length)) return found;
    cursor = found + 1;
  }
  return -1;
}
function __velarTextReplacementOutputUnits(value, search, replacement, all) {
  let matches = 0;
  if (search === "") matches = all ? __velarTextCodePointLength(value) + 1 : 1;
  else {
    let cursor = 0;
    while (true) {
      const index = __velarTextBoundedIndexOf(value, search, cursor);
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

// TXT-D1: ordered string comparison uses code-point order (= UTF-8 binary
// order). UTF-16 code-unit order already agrees when neither operand
// contains a surrogate, so the native probe keeps the decoded walk on
// surrogate-bearing strings only.
function __velarStringCompare(left, right) {
  left = __velarTextValue(left);
  right = __velarTextValue(right);
  if (left === right) return 0;
  if (__velarTextCall(__velarTextSurrogateExec, __velarTextSurrogatePattern, [left]) === null
    && __velarTextCall(__velarTextSurrogateExec, __velarTextSurrogatePattern, [right]) === null) {
    return left < right ? -1 : 1;
  }
  let leftOffset = 0;
  let rightOffset = 0;
  while (leftOffset < left.length && rightOffset < right.length) {
    let first = __velarTextCall(__velarNativeStringCharCodeAt, left, [leftOffset]);
    let firstUnits = 1;
    if (first >= 0xD800 && first <= 0xDBFF && leftOffset + 1 < left.length) {
      const trail = __velarTextCall(__velarNativeStringCharCodeAt, left, [leftOffset + 1]);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { first = (first - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; firstUnits = 2; }
    }
    let second = __velarTextCall(__velarNativeStringCharCodeAt, right, [rightOffset]);
    let secondUnits = 1;
    if (second >= 0xD800 && second <= 0xDBFF && rightOffset + 1 < right.length) {
      const trail = __velarTextCall(__velarNativeStringCharCodeAt, right, [rightOffset + 1]);
      if (trail >= 0xDC00 && trail <= 0xDFFF) { second = (second - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000; secondUnits = 2; }
    }
    if (first !== second) return first < second ? -1 : 1;
    leftOffset += firstUnits;
    rightOffset += secondUnits;
  }
  return leftOffset < left.length ? 1 : rightOffset < right.length ? -1 : 0;
}
// D41 item 61: two 'Comparable'-bounded values hold numbers or strings, and
// which one is known only at runtime. A string pair keeps code-point order
// (TXT-D1); everything else uses the plain relational order, exactly as a
// monomorphic comparison of that category would.
// D90 R6: one NaN policy. A NaN may be held and tested with .isNaN(), but an
// operation that orders it raises instead of answering. Without this the
// "neither less nor greater" arm returned 0, which made NaN compare both <=
// and >= as true at a generic site while the same source on a plain number
// answered false, and produced genuinely mis-sorted output.
function __velarOrderCompare(left, right) {
  if (typeof left === "string" && typeof right === "string") return __velarStringCompare(left, right);
  if (left !== left || right !== right) throw new __velarTextNativeTypeError("ordered comparison found NaN, which has no ordering; drop it with filter(x => not x.isNaN()) or fix the upstream computation");
  return left < right ? -1 : left > right ? 1 : 0;
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
function __velarStringHas(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.has text");
  return text === "" || __velarTextBoundedIndexOf(value, text, 0) >= 0;
}
function __velarStringIndex(value, text, start = 0) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.index text");
  if (!__velarTextCall(__velarTextNumberIsInteger, __velarTextNativeNumber, [start])) throw new __velarTextNativeTypeError("String.index start must be an integer");
  const total = __velarTextCodePointLength(value);
  const first = start < 0 ? __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [total + start, 0]) : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [start, total]);
  const cursor = __velarTextCodeUnitOffset(value, first);
  if (text === "") return first;
  const found = __velarTextBoundedIndexOf(value, text, cursor);
  if (found < 0) return null;
  return __velarTextCodePointIndex(value, found);
}
function __velarStringCount(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.count text");
  if (text === "") return __velarTextCodePointLength(value) + 1;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = __velarTextBoundedIndexOf(value, text, cursor);
    if (index < 0) return count;
    count += 1;
    cursor = index + text.length;
  }
}
function __velarStringStartsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.startsWith text");
  return __velarTextCall(__velarNativeStringIndexOf, value, [text, 0]) === 0 && __velarTextIsBoundary(value, text.length);
}
function __velarStringEndsWith(value, text) {
  value = __velarTextValue(value); text = __velarTextArgument(text, "String.endsWith text");
  const start = value.length - text.length;
  return start >= 0 && __velarTextIsBoundary(value, start) && __velarTextCall(__velarNativeStringIndexOf, value, [text, start]) === start;
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
  // The native split matches UTF-16 code units, so it would cut a surrogate
  // pair in half on a separator that begins or ends with an unpaired
  // surrogate. Every other separator makes the two scans agree match for
  // match, and the native one is the faster: its limit argument also stops it
  // before it can build an oversize array.
  if (!__velarTextNeedsBoundaryCheck(separator)) {
    return __velarTextList(__velarTextCall(__velarNativeStringSplit, value, [separator, __velarMaxTextItems + 1]), "String.split");
  }
  // Searching on code-point boundaries keeps every piece well formed; the
  // pieces themselves are still plain slices of the input.
  const parts = new __velarTextNativeArray();
  let cursor = 0;
  while (true) {
    const found = __velarTextBoundedIndexOf(value, separator, cursor);
    if (found < 0) break;
    parts[parts.length] = __velarTextCall(__velarNativeStringSlice, value, [cursor, found]);
    if (parts.length > __velarMaxTextItems) return __velarTextList(parts, "String.split");
    cursor = found + separator.length;
  }
  parts[parts.length] = __velarTextCall(__velarNativeStringSlice, value, [cursor]);
  return __velarTextList(parts, "String.split");
}
function __velarStringReplace(value, from, to) {
  value = __velarTextValue(value); from = __velarTextArgument(from, "String.replace from"); to = __velarTextArgument(to, "String.replace to");
  if (__velarTextReplacementOutputUnits(value, from, to, false) > __velarMaxTextCodeUnits) throw new __velarTextNativeRangeError("String.replace output cannot exceed 16 MiB");
  if (from === "") return to + value;
  const found = __velarTextBoundedIndexOf(value, from, 0);
  if (found < 0) return value;
  return __velarTextCall(__velarNativeStringSlice, value, [0, found]) + to + __velarTextCall(__velarNativeStringSlice, value, [found + from.length]);
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
  // A separator that cannot split a pair leaves nothing for the bounded walk
  // to reject, so the native rewrite answers the same string faster. The
  // replacement is passed as a function so that a '$' in it stays literal.
  if (!__velarTextNeedsBoundaryCheck(from)) return __velarTextCall(__velarNativeStringReplaceAll, value, [from, () => to]);
  let output = "";
  let cursor = 0;
  while (true) {
    const found = __velarTextBoundedIndexOf(value, from, cursor);
    if (found < 0) break;
    output += __velarTextCall(__velarNativeStringSlice, value, [cursor, found]) + to;
    cursor = found + from.length;
  }
  return output + __velarTextCall(__velarNativeStringSlice, value, [cursor]);
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
