const maxTextCodeUnits = __velarMaxTextCodeUnits;
const maxTextItems = __velarMaxTextItems;
const maxTextPatternMillis = 250;
const __velarTextGetOwnPropertyNames = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getOwnPropertyNames")?.value;
const __velarTextGetOwnPropertySymbols = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getOwnPropertySymbols")?.value;
const __velarTextGetPrototypeOf = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "getPrototypeOf")?.value;
const __velarTextObjectPrototype = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "prototype")?.value;
const __velarTextObjectCreate = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "create")?.value;
const __velarTextObjectFreeze = __velarTextGetOwnPropertyDescriptor(__velarTextNativeObject, "freeze")?.value;
const __velarTextArrayPrototype = __velarTextGetOwnPropertyDescriptor(__velarTextNativeArray, "prototype")?.value;
const __velarTextArrayJoin = __velarTextGetOwnPropertyDescriptor(__velarTextArrayPrototype, "join")?.value;
const __velarTextStringTrimStart = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "trimStart")?.value;
const __velarTextStringTrimEnd = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "trimEnd")?.value;
const __velarTextStringNormalize = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "normalize")?.value;
const __velarTextNativeDate = globalThis.Date;
const __velarTextDateNow = __velarTextGetOwnPropertyDescriptor(__velarTextNativeDate, "now")?.value;
const nativeRegExpPrototype = __velarTextGetPrototypeOf(/(?:)/u);
const NativeRegExp = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "constructor")?.value;
const nativeRegExpExec = __velarTextGetOwnPropertyDescriptor(nativeRegExpPrototype, "exec")?.value;
const nativeStringReplaceAll = __velarNativeStringReplaceAll;
const __velarTextStringCodePointAt = __velarTextGetOwnPropertyDescriptor(__velarTextStringPrototype, "codePointAt")?.value;
const __velarTextStringFromCodePoint = __velarTextGetOwnPropertyDescriptor(__velarTextNativeString, "fromCodePoint")?.value;
const __velarTextTitleSeparators = /[_\-/]+/gu;
const __velarTextTitleWords = /(^|\s)([\p{L}\p{N}])/gu;
// A line ends at CRLF, at a lone CR, or at LF — the same three the language
// itself accepts as a statement separator and the same three
// SourceText indexes for diagnostics. A text API that disagreed with its
// own language would make Text.lineStarts on Vel source compute line
// numbers the compiler does not report.
const __velarTextLines = /\r\n|[\r\n]/gu;
const __velarTextWords = /\s+/gu;
const __velarTextLatinMarks = /(?<=\p{Script=Latin})\p{M}+/gu;
const __velarTextBaselessMarks = /(?<![\p{L}\p{N}\p{M}])\p{M}+/gu;
const __velarTextSlugSeparators = /[^\p{L}\p{N}\p{M}]+/gu;
const __velarTextSlugEdges = /^-+|-+$/gu;
const __velarTextWhitespace = /\s+/gu;
const __velarTextPatternPrefix = /^Invalid regular expression: (?:\/[\s\S]*\/[a-z]*: )?/u;
function __velarTextAppend(values, value) { values[values.length] = value; }
function __velarTextJoin(values, separator) { return __velarTextCall(__velarTextArrayJoin, values, [separator]); }
// TXT-P2: bounded work is already the promise on this surface — the code-unit
// and item caps are here — and time was the dimension that was missed, so a
// backtracking pattern over hostile input could run for as long as it liked.
// Every operation that runs a pattern the author supplied gets a fresh budget,
// checked at every exec boundary. The engine is not interruptible, so one
// catastrophic exec is caught when it returns rather than pre-empted; that
// still turns a silent unbounded hang into a loud bounded failure and stops
// the amplification a per-match loop would otherwise give it. The budget is
// deliberately not charged to slug, title or normalizeWhitespace: they run
// this module's own linear patterns, so their only bound is on size, and a
// wall clock would otherwise make a large but legal text succeed or fail by
// how busy the machine is.
function patternDeadline() { return __velarTextCall(__velarTextDateNow, __velarTextNativeDate, []) + maxTextPatternMillis; }
function checkPatternDeadline(deadline) {
  if (__velarTextCall(__velarTextDateNow, __velarTextNativeDate, []) > deadline) throw new __velarTextNativeRangeError("text pattern matching cannot exceed " + maxTextPatternMillis + " ms");
}
function __velarTextRegexReplace(value, pattern, replacement) {
  pattern.lastIndex = 0;
  const output = []; let end = 0, units = 0;
  while (true) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    if (raw === null) break;
    const match = checkedMatchValue(raw, value);
    const before = __velarTextCall(__velarNativeStringSlice, value, [end, match.unitIndex]);
    const next = typeof replacement === "function" ? replacement(match) : replacement;
    if (typeof next !== "string") throw new __velarTextNativeTypeError("Text replacement must produce a string");
    units += before.length + next.length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text replacement output cannot exceed 16 MiB");
    __velarTextAppend(output, before); __velarTextAppend(output, next);
    end = match.unitIndex + match.value.length;
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
  const tail = __velarTextCall(__velarNativeStringSlice, value, [end]);
  if (units + tail.length > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text replacement output cannot exceed 16 MiB");
  __velarTextAppend(output, tail); pattern.lastIndex = 0;
  return __velarTextJoin(output, "");
}
function __velarTextRegexSplit(value, pattern, limit) {
  pattern.lastIndex = 0;
  const output = []; let end = 0;
  while (output.length + 1 < limit) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    if (raw === null) break;
    const match = checkedMatchValue(raw, value);
    __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end, match.unitIndex]));
    end = match.unitIndex + match.value.length;
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
  if (output.length < limit) __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end]));
  pattern.lastIndex = 0;
  return output;
}
function valueOf(value) { return __velarTextArgument(value, "velar/text value"); }
function textOutput(value, name) { return __velarTextOutput(value, name); }
function textCount(value, name) { return __velarTextCount(value, name); }
function textList(values, name) { return __velarTextList(values, name); }
function htmlOutputUnits(value) {
  let units = value.length;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "&" || character === "'") units += 4;
    else if (character === "<" || character === ">") units += 3;
    else if (character === '"') units += 5;
    if (units > maxTextCodeUnits) return units;
  }
  return units;
}
const codePointLength = __velarTextCodePointLength;
const codePointPrefix = __velarTextCodePointPrefix;
function patternOptions(value) {
  if (value == null) return {};
  const prototype = typeof value === "object" && value !== null ? __velarTextGetPrototypeOf(value) : undefined;
  if (typeof value !== "object" || value === null || __velarTextCall(__velarTextArrayIsArray, __velarTextNativeArray, [value]) || (prototype !== __velarTextObjectPrototype && prototype !== null)) throw new __velarTextNativeTypeError("text pattern options must be a record");
  if (__velarTextGetOwnPropertySymbols(value).length > 0) throw new __velarTextNativeTypeError("text pattern options cannot contain symbol fields");
  const output = __velarTextCall(__velarTextObjectCreate, __velarTextNativeObject, [null]);
  const names = __velarTextGetOwnPropertyNames(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = __velarTextGetOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarTextNativeTypeError("Text pattern option '" + name + "' must be an enumerable data field");
    if (name !== "ignoreCase" && name !== "multiline" && name !== "dotAll") throw new __velarTextNativeTypeError("Unknown text pattern option '" + name + "'");
    const option = descriptor.value;
    if (option != null && typeof option !== "boolean") throw new __velarTextNativeTypeError("Text pattern option '" + name + "' must be bool");
    output[name] = option;
  }
  return output;
}
// TXT-P1: the engine's reason is the only actionable half of an invalid-pattern
// failure. Patterns compile in 'u' mode, so an identity escape that is tolerated
// everywhere else in JavaScript is an error here, and "[a-z" and "\\@" are
// otherwise byte-identical failures. The host-shaped prefix is stripped so the
// engine's own text does not travel verbatim, and a caught value that is not an
// Error, or carries no usable message, falls back to the bare message.
function patternReason(error) {
  if (typeof error !== "object" || error === null) return "";
  const descriptor = __velarTextGetOwnPropertyDescriptor(error, "message");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return "";
  const message = descriptor.value;
  const prefix = __velarTextCall(nativeRegExpExec, __velarTextPatternPrefix, [message]);
  const head = prefix === null ? null : __velarTextGetOwnPropertyDescriptor(prefix, 0);
  const reason = head && typeof head.value === "string" ? __velarTextCall(__velarNativeStringSlice, message, [head.value.length]) : message;
  return reason === "" || reason.length > 200 ? "" : ": " + reason;
}
function patternOf(expression, options, global = false) {
  expression = valueOf(expression); options = patternOptions(options);
  if (expression.length > 4096) throw new __velarTextNativeRangeError("text patterns cannot exceed 4096 code units");
  let flags = "u";
  if (global) flags += "g";
  if (options.ignoreCase === true) flags += "i";
  if (options.multiline === true) flags += "m";
  if (options.dotAll === true) flags += "s";
  try { return new NativeRegExp(expression, flags); }
  catch (error) { throw new __velarTextNativeTypeError("Invalid text pattern" + patternReason(error)); }
}
function checkedMatchValue(match, input) {
  if (!__velarTextCall(__velarTextArrayIsArray, __velarTextNativeArray, [match]) || match.length < 1 || match.length > 4097) throw new __velarTextNativeTypeError("The regular expression engine returned an invalid match");
  const groups = new __velarTextNativeArray(match.length - 1);
  for (let index = 0; index < match.length; index += 1) {
    const descriptor = __velarTextGetOwnPropertyDescriptor(match, index);
    if (!descriptor || !("value" in descriptor)) throw new __velarTextNativeTypeError("Regular expression matches must contain data values");
    const value = descriptor.value;
    if (value !== undefined && typeof value !== "string") throw new __velarTextNativeTypeError("Regular expression match values must be strings");
    if (index === 0) {
      if (typeof value !== "string") throw new __velarTextNativeTypeError("A regular expression match requires full text");
    } else groups[index - 1] = value === undefined ? null : value;
  }
  const indexDescriptor = __velarTextGetOwnPropertyDescriptor(match, "index");
  if (!indexDescriptor || !("value" in indexDescriptor) || !__velarTextCall(__velarTextNumberIsSafeInteger, __velarTextNativeNumber, [indexDescriptor.value]) || indexDescriptor.value < 0 || indexDescriptor.value > input.length) throw new __velarTextNativeTypeError("A regular expression match requires a valid index");
  return { value: __velarTextGetOwnPropertyDescriptor(match, 0).value, groups, unitIndex: indexDescriptor.value };
}
function publicMatchValue(checked, input, index = null) {
  if (index === null) index = __velarTextCodePointIndex(input, checked.unitIndex);
  if (index === null) throw new __velarTextNativeTypeError("A regular expression match must begin at a Unicode code-point boundary");
  return __velarTextCall(__velarTextObjectFreeze, __velarTextNativeObject, [{ value: checked.value, index, groups: checked.groups }]);
}
function nextTextIndex(value, index) {
  return index >= value.length ? index + 1 : __velarTextNextCodePointOffset(value, index);
}
function eachMatch(value, pattern, visit) {
  const deadline = patternDeadline();
  let count = 0, units = 0, previousUnitIndex = 0, previousCodePointIndex = 0;
  while (true) {
    const raw = __velarTextCall(nativeRegExpExec, pattern, [value]);
    checkPatternDeadline(deadline);
    if (raw === null) return;
    if (count >= maxTextItems) throw new __velarTextNativeRangeError("Text patterns cannot produce more than " + maxTextItems + " matches");
    count += 1;
    const checked = checkedMatchValue(raw, value);
    const distance = __velarTextCodePointDistance(value, previousUnitIndex, checked.unitIndex);
    if (distance === null) throw new __velarTextNativeTypeError("A regular expression match must begin at a Unicode code-point boundary");
    const match = publicMatchValue(checked, value, previousCodePointIndex + distance);
    previousUnitIndex = checked.unitIndex;
    previousCodePointIndex = match.index;
    units += match.value.length;
    for (let index = 0; index < match.groups.length; index += 1) { const group = match.groups[index]; if (group !== null) units += group.length; }
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("Text pattern results cannot exceed 16 MiB");
    visit(match, checked.unitIndex);
    if (match.value === "") pattern.lastIndex = nextTextIndex(value, pattern.lastIndex);
  }
}
export function trimStart(value) { return __velarTextCall(__velarTextStringTrimStart, valueOf(value), []); }
export function trimEnd(value) { return __velarTextCall(__velarTextStringTrimEnd, valueOf(value), []); }
export function capitalize(value) { value = valueOf(value); if (!value) return ""; const end = __velarTextNextCodePointOffset(value, 0); const first = __velarTextCall(__velarNativeStringSlice, value, [0, end]); const tail = __velarTextCall(__velarNativeStringSlice, value, [end]); return textOutput(__velarTextCall(__velarNativeStringUpper, first, []) + __velarTextCall(__velarNativeStringLower, tail, []), "capitalize"); }
export function title(value) { let output = __velarTextCall(__velarNativeStringLower, valueOf(value), []); output = __velarTextRegexReplace(output, __velarTextTitleSeparators, " "); output = __velarTextRegexReplace(output, __velarTextTitleWords, match => match.groups[0] + __velarTextCall(__velarNativeStringUpper, match.groups[1], [])); return textOutput(output, "title"); }
export function lines(value) { return textList(__velarTextRegexSplit(valueOf(value), __velarTextLines, maxTextItems + 1), "lines"); }
export function lineStarts(value) {
  value = valueOf(value);
  const output = [0];
  let unitOffset = 0, codePointOffset = 0;
  while (unitOffset < value.length) {
    const nextUnitOffset = __velarTextNextCodePointOffset(value, unitOffset);
    const code = __velarTextCall(__velarNativeStringCharCodeAt, value, [unitOffset]);
    // CRLF is one break, not two: consume the LF with the CR so the following
    // line starts once. A lone CR breaks as well — see __velarTextLines.
    if (code === 13 && __velarTextCall(__velarNativeStringCharCodeAt, value, [nextUnitOffset]) === 10) {
      __velarTextAppend(output, codePointOffset + 2);
      unitOffset = __velarTextNextCodePointOffset(value, nextUnitOffset);
      codePointOffset += 2;
      continue;
    }
    if (code === 10 || code === 13) __velarTextAppend(output, codePointOffset + 1);
    unitOffset = nextUnitOffset;
    codePointOffset += 1;
  }
  return textList(output, "lineStarts");
}
export function chunks(value, size) {
  value = valueOf(value);
  size = textCount(size, "chunks size");
  if (size === 0) throw new __velarTextNativeRangeError("chunks size must be greater than zero");
  if (value.length === 0) return [];
  const output = [];
  let start = 0, offset = 0, count = 0;
  while (offset < value.length) {
    offset = __velarTextNextCodePointOffset(value, offset);
    count += 1;
    if (count === size) {
      if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("chunks cannot produce more than " + maxTextItems + " items");
      __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [start, offset]));
      start = offset;
      count = 0;
    }
  }
  if (start < value.length) {
    if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("chunks cannot produce more than " + maxTextItems + " items");
    __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [start]));
  }
  return textList(output, "chunks");
}
export function words(value) { const cleaned = __velarTextCall(__velarNativeStringTrim, valueOf(value), []); return cleaned ? textList(__velarTextRegexSplit(cleaned, __velarTextWords, maxTextItems + 1), "words") : []; }
// TXT-U4: the NFKD pass is folding machinery, not a result. Text equality is
// code-point-sequence identity, so a decomposed slug misses the text it renders
// as — a Hangul syllable comes back as conjoining jamo and never matches the
// title it was made from. The output is recomposed to NFC before it leaves.
// Folding only reaches marks sitting on a Latin base, because dropping a mark
// is meaning-preserving there and meaning-destroying everywhere else: every
// other script keeps its marks, and those slugs are percent-encoded in a URL.
// Marks the separator pass now has to keep must still have something to sit
// on: a mark run with no letter or digit before it — a variation selector left
// behind by a dropped emoji, a stray accent — is invisible in a URL, so two
// slugs that read alike would name different pages. Those runs go.
export function slug(value) { let output = __velarTextCall(__velarTextStringNormalize, valueOf(value), ["NFKD"]); output = __velarTextRegexReplace(output, __velarTextLatinMarks, ""); output = __velarTextRegexReplace(output, __velarTextBaselessMarks, ""); output = __velarTextCall(__velarNativeStringLower, output, []); output = __velarTextCall(__velarNativeStringTrim, output, []); output = __velarTextRegexReplace(output, __velarTextSlugSeparators, "-"); output = __velarTextRegexReplace(output, __velarTextSlugEdges, ""); return textOutput(__velarTextCall(__velarTextStringNormalize, output, ["NFC"]), "slug"); }
// TXT-U3: text equality is code-point-sequence identity, so "café" typed on a
// keyboard (NFC) and the same name read back from a macOS filename (NFD) are
// different values with different sizes. This is the boundary tool that makes
// them one value; the four Unicode forms are the only accepted spellings.
export function normalize(value, form = "NFC") {
  value = valueOf(value);
  form = valueOf(form);
  if (form !== "NFC" && form !== "NFD" && form !== "NFKC" && form !== "NFKD") {
    throw new __velarTextNativeRangeError("normalize form must be NFC, NFD, NFKC, or NFKD");
  }
  return textOutput(__velarTextCall(__velarTextStringNormalize, value, [form]), "normalize");
}
export function truncate(value, length, suffix = "…") { value = valueOf(value); suffix = valueOf(suffix); length = textCount(length, "truncate length"); const valueLength = codePointLength(value); if (valueLength <= length) return value; const suffixLength = codePointLength(suffix); if (suffixLength >= length) return codePointPrefix(suffix, length); return codePointPrefix(value, length - suffixLength) + suffix; }
export function indent(value, prefix = "    ") {
  const rows = lines(valueOf(value)); prefix = valueOf(prefix);
  let units = __velarTextCall(__velarTextMathMax, __velarTextNativeMath, [0, rows.length - 1]);
  const output = new __velarTextNativeArray(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    units += prefix.length + rows[index].length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("indent output cannot exceed 16 MiB");
    output[index] = prefix + rows[index];
  }
  return __velarTextJoin(output, "\n");
}
export function dedent(value) { const rows = lines(valueOf(value)); let width = null; for (let index = 0; index < rows.length; index += 1) { const line = rows[index]; if (__velarTextCall(__velarNativeStringTrim, line, [])) { let current = 0; while (current < line.length && (line[current] === " " || line[current] === "\t")) current += 1; width = width === null ? current : __velarTextCall(__velarTextMathMin, __velarTextNativeMath, [width, current]); } } const output = new __velarTextNativeArray(rows.length); for (let index = 0; index < rows.length; index += 1) output[index] = __velarTextCall(__velarNativeStringSlice, rows[index], [width ?? 0]); return __velarTextJoin(output, "\n"); }
export function normalizeWhitespace(value) { return __velarTextRegexReplace(__velarTextCall(__velarNativeStringTrim, valueOf(value), []), __velarTextWhitespace, " "); }
export function utf8Size(value) { return __velarUtf8ByteLength(valueOf(value)); }
export function escapeHtml(value) {
  value = valueOf(value);
  if (htmlOutputUnits(value) > maxTextCodeUnits) throw new __velarTextNativeRangeError("escapeHtml output cannot exceed 16 MiB");
  const replacements = [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&#39;"]];
  for (let index = 0; index < replacements.length; index += 1) {
    const pair = replacements[index];
    value = __velarTextCall(nativeStringReplaceAll, value, [pair[0], pair[1]]);
  }
  return value;
}
// TXT-U4 (D50 rule 90 item 4): one character in, one code point out. Anything
// that is not exactly one code point — empty text, several characters, or a
// lone surrogate half — answers null rather than a partial reading, and the
// inverse refuses to build a surrogate half that could never stand alone.
export function codePoint(value) {
  value = valueOf(value);
  if (value.length === 0 || __velarTextNextCodePointOffset(value, 0) !== value.length) return null;
  const point = __velarTextCall(__velarTextStringCodePointAt, value, [0]);
  if (typeof point !== "number" || point >= 0xD800 && point <= 0xDFFF) return null;
  return point;
}
export function fromCodePoint(value) {
  if (!__velarTextCall(__velarTextNumberIsSafeInteger, __velarTextNativeNumber, [value]) || value < 0 || value > 0x10FFFF) {
    throw new __velarTextNativeRangeError("fromCodePoint requires a code point from 0 through 1114111");
  }
  if (value >= 0xD800 && value <= 0xDFFF) throw new __velarTextNativeRangeError("fromCodePoint refuses surrogate halves; they are not characters on their own");
  return __velarTextCall(__velarTextStringFromCodePoint, __velarTextNativeString, [value]);
}
export function matches(value, expression, options = {}) { value = valueOf(value); const pattern = patternOf(expression, options); const deadline = patternDeadline(); const found = __velarTextCall(nativeRegExpExec, pattern, [value]) !== null; checkPatternDeadline(deadline); return found; }
export function findMatch(value, expression, options = {}) { value = valueOf(value); const pattern = patternOf(expression, options); const deadline = patternDeadline(); const match = __velarTextCall(nativeRegExpExec, pattern, [value]); checkPatternDeadline(deadline); return match === null ? null : publicMatchValue(checkedMatchValue(match, value), value); }
export function findMatches(value, expression, options = {}) { value = valueOf(value); const output = []; eachMatch(value, patternOf(expression, options, true), match => __velarTextAppend(output, match)); return output; }
export function replaceMatches(value, expression, replacement, options = {}) {
  value = valueOf(value); replacement = valueOf(replacement);
  const output = []; let end = 0, units = 0;
  eachMatch(value, patternOf(expression, options, true), (match, unitIndex) => {
    const before = __velarTextCall(__velarNativeStringSlice, value, [end, unitIndex]);
    units += before.length + replacement.length;
    if (units > maxTextCodeUnits) throw new __velarTextNativeRangeError("replaceMatches output cannot exceed 16 MiB");
    __velarTextAppend(output, before); __velarTextAppend(output, replacement);
    end = unitIndex + match.value.length;
  });
  const tail = __velarTextCall(__velarNativeStringSlice, value, [end]);
  if (units + tail.length > maxTextCodeUnits) throw new __velarTextNativeRangeError("replaceMatches output cannot exceed 16 MiB");
  __velarTextAppend(output, tail);
  return __velarTextJoin(output, "");
}
export function splitPattern(value, expression, options = {}) {
  value = valueOf(value); const output = []; let end = 0;
  eachMatch(value, patternOf(expression, options, true), (match, unitIndex) => { if (output.length >= maxTextItems) throw new __velarTextNativeRangeError("splitPattern cannot produce more than " + maxTextItems + " items"); __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end, unitIndex])); end = unitIndex + match.value.length; });
  __velarTextAppend(output, __velarTextCall(__velarNativeStringSlice, value, [end])); return textList(output, "splitPattern");
}
