const maximumDateMilliseconds = 8_640_000_000_000_000;
const localDayWindowMilliseconds = 108_000_000;
const __velarTimeNativeObject = globalThis.Object;
const __velarTimeNativeArray = globalThis.Array;
const __velarTimeNativeNumber = globalThis.Number;
const __velarTimeNativeString = globalThis.String;
const __velarTimeNativeMath = globalThis.Math;
const __velarTimeNativeDate = globalThis.Date;
const __velarTimeNativeTypeError = globalThis.TypeError;
const __velarTimeNativeRangeError = globalThis.RangeError;
const __velarTimeGetOwnPropertyDescriptor = __velarTimeNativeObject.getOwnPropertyDescriptor;
const __velarTimeGetPrototypeOf = __velarTimeNativeObject.getPrototypeOf;
const __velarTimeApply = __velarTimeGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
function __velarTimeHostData(owner, key, kind) {
  const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
  return descriptor.value;
}
function __velarTimeHostOperation(owner, key) { return __velarTimeHostData(owner, key, "function"); }
function __velarTimeHostGetter(owner, key) {
  const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || typeof descriptor.get !== "function") throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
  return descriptor.get;
}
function __velarTimeInheritedOperation(owner, key) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarTimeGetOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API must be a data function");
      return descriptor.value;
    }
    owner = __velarTimeGetPrototypeOf(owner);
  }
  throw new __velarTimeNativeTypeError("The JavaScript " + key + " time API is unavailable");
}
const __velarTimeDatePrototype = __velarTimeHostData(__velarTimeNativeDate, "prototype", "object");
const __velarTimeIntl = __velarTimeHostData(globalThis, "Intl", "object");
const __velarTimeDateTimeFormat = __velarTimeHostOperation(__velarTimeIntl, "DateTimeFormat");
const __velarTimeDateTimeFormatPrototype = __velarTimeHostData(__velarTimeDateTimeFormat, "prototype", "object");
const __velarTimeRegExpPattern = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}(?::?\d{2})?))?$/u;
const __velarTimeDigitsPattern = /^\d{1,6}$/u;
const __velarTimeRegExpPrototype = __velarTimeGetPrototypeOf(__velarTimeRegExpPattern);
const __velarTimeDateNow = __velarTimeHostOperation(__velarTimeNativeDate, "now");
const __velarTimeMathAbs = __velarTimeHostOperation(__velarTimeNativeMath, "abs");
const __velarTimeMathFloor = __velarTimeHostOperation(__velarTimeNativeMath, "floor");
const __velarTimeNumberIsFinite = __velarTimeHostOperation(__velarTimeNativeNumber, "isFinite");
const __velarTimeNumberIsInteger = __velarTimeHostOperation(__velarTimeNativeNumber, "isInteger");
const __velarTimeNumberIsSafeInteger = __velarTimeHostOperation(__velarTimeNativeNumber, "isSafeInteger");
const __velarTimeArrayIsArray = __velarTimeHostOperation(__velarTimeNativeArray, "isArray");
const __velarTimeObjectFreeze = __velarTimeHostOperation(__velarTimeNativeObject, "freeze");
const __velarTimeStringPadEnd = __velarTimeHostOperation(__velarTimeHostData(__velarTimeNativeString, "prototype", "object"), "padEnd");
const __velarTimeStringSlice = __velarTimeHostOperation(__velarTimeHostData(__velarTimeNativeString, "prototype", "object"), "slice");
const __velarTimeRegExpExec = __velarTimeHostOperation(__velarTimeRegExpPrototype, "exec");
const __velarTimeFormatGetter = __velarTimeHostGetter(__velarTimeDateTimeFormatPrototype, "format");
const __velarTimeFormatToParts = __velarTimeHostOperation(__velarTimeDateTimeFormatPrototype, "formatToParts");
const __velarTimeSetUTCFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "setUTCFullYear");
const __velarTimeSetUTCHours = __velarTimeHostOperation(__velarTimeDatePrototype, "setUTCHours");
const __velarTimeSetFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "setFullYear");
const __velarTimeSetHours = __velarTimeHostOperation(__velarTimeDatePrototype, "setHours");
const __velarTimeSetTime = __velarTimeHostOperation(__velarTimeDatePrototype, "setTime");
const __velarTimeGetUTCFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCFullYear");
const __velarTimeGetUTCMonth = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMonth");
const __velarTimeGetUTCDate = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCDate");
const __velarTimeGetUTCHours = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCHours");
const __velarTimeGetUTCMinutes = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMinutes");
const __velarTimeGetUTCSeconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCSeconds");
const __velarTimeGetUTCMilliseconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getUTCMilliseconds");
const __velarTimeGetFullYear = __velarTimeHostOperation(__velarTimeDatePrototype, "getFullYear");
const __velarTimeGetMonth = __velarTimeHostOperation(__velarTimeDatePrototype, "getMonth");
const __velarTimeGetDate = __velarTimeHostOperation(__velarTimeDatePrototype, "getDate");
const __velarTimeGetDay = __velarTimeHostOperation(__velarTimeDatePrototype, "getDay");
const __velarTimeGetHours = __velarTimeHostOperation(__velarTimeDatePrototype, "getHours");
const __velarTimeGetMinutes = __velarTimeHostOperation(__velarTimeDatePrototype, "getMinutes");
const __velarTimeGetSeconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getSeconds");
const __velarTimeGetMilliseconds = __velarTimeHostOperation(__velarTimeDatePrototype, "getMilliseconds");
const __velarTimeGetTime = __velarTimeHostOperation(__velarTimeDatePrototype, "getTime");
const __velarTimeToISOString = __velarTimeHostOperation(__velarTimeDatePrototype, "toISOString");
const __velarTimePerformanceCandidate = globalThis.performance;
const __velarTimePerformance = typeof __velarTimePerformanceCandidate === "object" && __velarTimePerformanceCandidate !== null ? __velarTimePerformanceCandidate : null;
const __velarTimePerformanceNow = __velarTimePerformance === null ? null : __velarTimeInheritedOperation(__velarTimePerformance, "now");
if (typeof __velarTimeApply !== "function") throw new __velarTimeNativeTypeError("The JavaScript Reflect.apply time API is unavailable");
function __velarTimeCall(operation, receiver, arguments_) { return __velarTimeApply(operation, receiver, arguments_); }
function __velarTimeNumber(value) { return __velarTimeCall(__velarTimeNativeNumber, undefined, [value]); }
function __velarTimeFreeze(value) { return __velarTimeCall(__velarTimeObjectFreeze, __velarTimeNativeObject, [value]); }
function weekdayOf(value) {
  if (value === "Sun") return 0;
  if (value === "Mon") return 1;
  if (value === "Tue") return 2;
  if (value === "Wed") return 3;
  if (value === "Thu") return 4;
  if (value === "Fri") return 5;
  if (value === "Sat") return 6;
  return null;
}
function finiteNumber(value, name) { if (!__velarTimeCall(__velarTimeNumberIsFinite, __velarTimeNativeNumber, [value])) throw new __velarTimeNativeTypeError(name + " must be a finite number"); return value; }
function valid(value) { finiteNumber(value, "velar/time timestamp"); if (__velarTimeCall(__velarTimeMathAbs, __velarTimeNativeMath, [value]) > maximumDateMilliseconds) throw new __velarTimeNativeRangeError("velar/time timestamp is outside the JavaScript date range"); return value; }
function timeText(value, name) { if (typeof value !== "string") throw new __velarTimeNativeTypeError(name + " must be a string"); if (value.length > 1024) throw new __velarTimeNativeRangeError(name + " cannot exceed 1024 characters"); return value; }
function timeResultText(value, name, maximum = 65536) { if (typeof value !== "string") throw new __velarTimeNativeTypeError(name + " must return a string"); if (value.length > maximum) throw new __velarTimeNativeRangeError(name + " returned too much text"); return value; }
function timeStyleName(value, name) {
  value = timeText(value, name);
  if (value !== "full" && value !== "long" && value !== "medium" && value !== "short" && value !== "none") {
    throw new __velarTimeNativeTypeError(name + " must be one of full, long, medium, short, or none");
  }
  return value;
}
function ownData(container, key, name) {
  if (container === null || typeof container !== "object") throw new __velarTimeNativeTypeError(name + " must belong to an object");
  const descriptor = __velarTimeGetOwnPropertyDescriptor(container, key);
  if (!descriptor || !("value" in descriptor)) throw new __velarTimeNativeTypeError(name + " must be an own data field");
  return descriptor.value;
}
function boundedInteger(value, name, minimum, maximum) {
  if (!__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [value])) throw new __velarTimeNativeTypeError(name + " must be an integer");
  if (value < minimum || value > maximum) throw new __velarTimeNativeRangeError(name + " is out of range");
  return value;
}
function partInteger(value, name, minimum, maximum) {
  if (typeof value !== "string" || !__velarTimeCall(__velarTimeRegExpExec, __velarTimeDigitsPattern, [value])) throw new __velarTimeNativeTypeError("Time " + name + " part must be decimal text");
  return boundedInteger(__velarTimeNumber(value), "Time " + name + " part", minimum, maximum);
}
function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
function zonedParts(date, timeZone) {
  const formatter = new __velarTimeDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", era: "short", hourCycle: "h23" });
  const parts = __velarTimeCall(__velarTimeFormatToParts, formatter, [date]);
  if (!__velarTimeCall(__velarTimeArrayIsArray, __velarTimeNativeArray, [parts])) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat.formatToParts must return a List");
  const partCount = parts.length;
  if (!__velarTimeCall(__velarTimeNumberIsSafeInteger, __velarTimeNativeNumber, [partCount]) || partCount < 0) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an invalid time part count");
  if (partCount > 32) throw new __velarTimeNativeRangeError("Intl.DateTimeFormat returned too many time parts");
  let yearText = null, monthText = null, dayText = null, weekdayText = null;
  let hourText = null, minuteText = null, secondText = null, era = null;
  for (let index = 0; index < partCount; index += 1) {
    const part = ownData(parts, index, "Intl time part");
    const type = ownData(part, "type", "Intl time part type");
    const value = ownData(part, "value", "Intl time part value");
    timeResultText(type, "Intl time part type", 32);
    timeResultText(value, "Intl time part value", 64);
    if (type === "literal") continue;
    if (type === "year") { if (yearText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate year part"); yearText = value; }
    else if (type === "month") { if (monthText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate month part"); monthText = value; }
    else if (type === "day") { if (dayText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate day part"); dayText = value; }
    else if (type === "weekday") { if (weekdayText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate weekday part"); weekdayText = value; }
    else if (type === "hour") { if (hourText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate hour part"); hourText = value; }
    else if (type === "minute") { if (minuteText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate minute part"); minuteText = value; }
    else if (type === "second") { if (secondText !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate second part"); secondText = value; }
    else if (type === "era") { if (era !== null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned a duplicate era part"); era = value; }
    else throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported time part");
  }
  if (yearText === null || monthText === null || dayText === null || weekdayText === null || hourText === null || minuteText === null || secondText === null || era === null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat omitted a required time part");
  if (era !== "AD" && era !== "BC") throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported era");
  const displayedYear = partInteger(yearText, "year", 1, 999999);
  const year = era === "BC" ? 1 - displayedYear : displayedYear;
  const month = partInteger(monthText, "month", 1, 12);
  const day = partInteger(dayText, "day", 1, 31);
  if (day > daysInMonth(year, month)) throw new __velarTimeNativeRangeError("Intl.DateTimeFormat returned an impossible calendar date");
  const weekday = weekdayOf(weekdayText);
  if (weekday === null) throw new __velarTimeNativeTypeError("Intl.DateTimeFormat returned an unsupported weekday");
  return __velarTimeFreeze({
    year,
    month,
    day,
    weekday,
    hour: partInteger(hourText, "hour", 0, 23),
    minute: partInteger(minuteText, "minute", 0, 59),
    second: partInteger(secondText, "second", 0, 59),
    millisecond: boundedInteger(__velarTimeCall(__velarTimeGetUTCMilliseconds, date, []), "Time millisecond part", 0, 999),
  });
}
function calendarParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  if (!__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [year])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [month])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [day])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [hour])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [minute])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [second])
    || !__velarTimeCall(__velarTimeNumberIsInteger, __velarTimeNativeNumber, [millisecond])) throw new __velarTimeNativeTypeError("velar/time date parts must be integers");
  if (year < 0 || year > 9999) throw new __velarTimeNativeRangeError("velar/time year must be from 0 through 9999");
  if (month < 1 || month > 12) throw new __velarTimeNativeRangeError("velar/time month must be from 1 through 12");
  if (day < 1 || day > 31) throw new __velarTimeNativeRangeError("velar/time day is outside the selected month");
  if (hour < 0 || hour > 23) throw new __velarTimeNativeRangeError("velar/time hour must be from 0 through 23");
  if (minute < 0 || minute > 59 || second < 0 || second > 59) throw new __velarTimeNativeRangeError("velar/time minute and second must be from 0 through 59");
  if (millisecond < 0 || millisecond > 999) throw new __velarTimeNativeRangeError("velar/time millisecond must be from 0 through 999");
  return [year, month, day, hour, minute, second, millisecond];
}
function localDayOrder(value, year, month, day) {
  const currentYear = __velarTimeCall(__velarTimeGetFullYear, value, []);
  if (currentYear !== year) return currentYear < year ? -1 : 1;
  const currentMonth = __velarTimeCall(__velarTimeGetMonth, value, []) + 1;
  if (currentMonth !== month) return currentMonth < month ? -1 : 1;
  const currentDay = __velarTimeCall(__velarTimeGetDate, value, []);
  return currentDay === day ? 0 : currentDay < day ? -1 : 1;
}
function build(utc, year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0, resolveGap = false) {
  calendarParts(year, month, day, hour, minute, second, millisecond);
  const value = new __velarTimeNativeDate(0);
  if (utc) {
    __velarTimeCall(__velarTimeSetUTCFullYear, value, [year, month - 1, day]);
    __velarTimeCall(__velarTimeSetUTCHours, value, [hour, minute, second, millisecond]);
    if (__velarTimeCall(__velarTimeGetUTCFullYear, value, []) !== year || __velarTimeCall(__velarTimeGetUTCMonth, value, []) !== month - 1 || __velarTimeCall(__velarTimeGetUTCDate, value, []) !== day
      || __velarTimeCall(__velarTimeGetUTCHours, value, []) !== hour || __velarTimeCall(__velarTimeGetUTCMinutes, value, []) !== minute || __velarTimeCall(__velarTimeGetUTCSeconds, value, []) !== second || __velarTimeCall(__velarTimeGetUTCMilliseconds, value, []) !== millisecond) {
      throw new __velarTimeNativeRangeError("velar/time date parts do not form a real UTC date");
    }
  } else {
    // A local wall clock that a daylight-saving fall-back repeats names two real
    // instants and round-trips for both, so this resolves to the earlier,
    // pre-transition one, which is the ECMAScript LocalTZA default.
    __velarTimeCall(__velarTimeSetFullYear, value, [year, month - 1, day]);
    __velarTimeCall(__velarTimeSetHours, value, [hour, minute, second, millisecond]);
    if (localDayOrder(value, year, month, day) !== 0
      || __velarTimeCall(__velarTimeGetHours, value, []) !== hour || __velarTimeCall(__velarTimeGetMinutes, value, []) !== minute || __velarTimeCall(__velarTimeGetSeconds, value, []) !== second || __velarTimeCall(__velarTimeGetMilliseconds, value, []) !== millisecond) {
      // A caller who supplied a wall clock still gets the rejection. A caller who
      // named a calendar day and nothing else did not, so where a transition skips
      // local midnight the day resolves forward to its first existing instant
      // rather than becoming unrepresentable. A gap opens at 00:15 or 00:45 as
      // readily as at 01:00, so the window around the requested day is searched
      // to the millisecond for the least instant that has reached the day.
      if (!resolveGap) throw new __velarTimeNativeRangeError("velar/time date parts do not form a real local date");
      const anchor = __velarTimeCall(__velarTimeGetTime, value, []);
      let low = anchor - localDayWindowMilliseconds, high = anchor + localDayWindowMilliseconds;
      while (low < high) {
        const middle = low + __velarTimeCall(__velarTimeMathFloor, __velarTimeNativeMath, [(high - low) / 2]);
        __velarTimeCall(__velarTimeSetTime, value, [middle]);
        if (localDayOrder(value, year, month, day) < 0) low = middle + 1; else high = middle;
      }
      __velarTimeCall(__velarTimeSetTime, value, [low]);
      // The search answers the first instant at or after the requested day, so a
      // day the zone skipped whole lands on the next one and is still rejected.
      if (localDayOrder(value, year, month, day) !== 0) throw new __velarTimeNativeRangeError("velar/time date parts do not form a real local date");
    }
  }
  return valid(__velarTimeCall(__velarTimeGetTime, value, []));
}
export function now() { return valid(__velarTimeCall(__velarTimeDateNow, __velarTimeNativeDate, [])); }
export function monotonic() { return __velarTimePerformance === null ? now() : finiteNumber(__velarTimeCall(__velarTimePerformanceNow, __velarTimePerformance, []), "velar/time monotonic clock"); }
export function parse(value) {
  if (typeof value !== "string") throw new __velarTimeNativeTypeError("velar/time parse requires an ISO string");
  if (value.length > 64) return null;
  const match = __velarTimeCall(__velarTimeRegExpExec, __velarTimeRegExpPattern, [value]);
  if (!match) return null;
  try {
    const year = __velarTimeNumber(match[1]), month = __velarTimeNumber(match[2]), day = __velarTimeNumber(match[3]);
    if (!match[4]) return build(true, year, month, day);
    const hour = __velarTimeNumber(match[4]), minute = __velarTimeNumber(match[5]), second = __velarTimeNumber(match[6] ?? 0);
    const millisecond = __velarTimeNumber(__velarTimeCall(__velarTimeStringPadEnd, __velarTimeCall(__velarTimeStringSlice, match[7] ?? "", [0, 3]), [3, "0"]) || 0);
    const zone = match[8];
    let offset = 0;
    if (zone !== "Z" && zone !== "z") {
      // Three spellings name one offset: '+HH:MM', the basic-format '+HHMM' that
      // log lines and databases emit, and the hour-only '+HH'. The minutes sit
      // at the end whenever they are written at all.
      const sign = zone[0] === "+" ? 1 : -1;
      const offsetHour = __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [1, 3]));
      const offsetMinute = zone.length === 3 ? 0 : __velarTimeNumber(__velarTimeCall(__velarTimeStringSlice, zone, [zone.length - 2]));
      if (offsetHour > 23 || offsetMinute > 59) return null;
      offset = sign * (offsetHour * 60 + offsetMinute);
    }
    // RFC 3339 §5.7 writes an inserted leap second as ':60'. No JavaScript clock
    // counts it, so it names the second that follows it, which is the instant a
    // reader of the timestamp means. A leap second is only ever inserted at the
    // end of a UTC day, which is the local 23:59 in 'Z' and some other wall
    // clock under an offset, so the rule is checked on the UTC instant rather
    // than on the written hour. Elsewhere ':60' is a typo, not a timestamp, and
    // still answers null instead of being absorbed as a one-second shift.
    const leap = second === 60;
    const instant = build(true, year, month, day, hour, minute, leap ? 59 : second, millisecond) - offset * 60_000;
    if (leap) {
      const second59 = instant - millisecond;
      if (second59 - __velarTimeCall(__velarTimeMathFloor, __velarTimeNativeMath, [second59 / 86_400_000]) * 86_400_000 !== 86_399_000) return null;
    }
    return valid(instant + (leap ? 1000 : 0));
  } catch { return null; }
}
export function iso(value = now()) { const date = new __velarTimeNativeDate(valid(value)); return timeResultText(__velarTimeCall(__velarTimeToISOString, date, []), "Date.toISOString", 64); }
export function format(value, locale = "", timeZone = "", dateStyle = "medium", timeStyle = "medium") {
  locale = timeText(locale, "Time locale");
  timeZone = timeText(timeZone, "Time zone");
  dateStyle = timeStyleName(dateStyle, "Time date style");
  timeStyle = timeStyleName(timeStyle, "Time time style");
  if (dateStyle === "none" && timeStyle === "none") throw new __velarTimeNativeTypeError("velar/time format needs a date style or a time style; both cannot be none");
  const options = {
    ...dateStyle === "none" ? {} : { dateStyle },
    ...timeStyle === "none" ? {} : { timeStyle },
    ...timeZone ? { timeZone } : {},
  };
  const formatter = new __velarTimeDateTimeFormat(locale || undefined, options);
  const boundFormat = __velarTimeCall(__velarTimeFormatGetter, formatter, []);
  if (typeof boundFormat !== "function") throw new __velarTimeNativeTypeError("Intl.DateTimeFormat.format must be a function");
  const output = __velarTimeCall(boundFormat, undefined, [new __velarTimeNativeDate(valid(value))]);
  return timeResultText(output, "Intl.DateTimeFormat.format");
}
export function date(year, month, day, hour = null, minute = null, second = null) { return build(false, year, month, day, hour ?? 0, minute ?? 0, second ?? 0, 0, hour === null && minute === null && second === null); }
export function utc(year, month, day, hour = 0, minute = 0, second = 0) { return build(true, year, month, day, hour, minute, second); }
export function parts(value, timeZone = "") {
  const date = new __velarTimeNativeDate(valid(value));
  timeZone = timeText(timeZone, "Time zone");
  if (!timeZone) return __velarTimeFreeze({
    year: boundedInteger(__velarTimeCall(__velarTimeGetFullYear, date, []), "Time year part", -271821, 275760),
    month: boundedInteger(__velarTimeCall(__velarTimeGetMonth, date, []) + 1, "Time month part", 1, 12),
    day: boundedInteger(__velarTimeCall(__velarTimeGetDate, date, []), "Time day part", 1, 31),
    weekday: boundedInteger(__velarTimeCall(__velarTimeGetDay, date, []), "Time weekday part", 0, 6),
    hour: boundedInteger(__velarTimeCall(__velarTimeGetHours, date, []), "Time hour part", 0, 23),
    minute: boundedInteger(__velarTimeCall(__velarTimeGetMinutes, date, []), "Time minute part", 0, 59),
    second: boundedInteger(__velarTimeCall(__velarTimeGetSeconds, date, []), "Time second part", 0, 59),
    millisecond: boundedInteger(__velarTimeCall(__velarTimeGetMilliseconds, date, []), "Time millisecond part", 0, 999),
  });
  return zonedParts(date, timeZone);
}
