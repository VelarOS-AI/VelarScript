const __velarLogNativeMap = globalThis.Map;
const __velarLogNativeSet = globalThis.Set;
const __velarLogNativeObject = globalThis.Object;
const __velarLogNativeDate = globalThis.Date;
const __velarLogNativeNumber = globalThis.Number;
const __velarLogNativeMath = globalThis.Math;
const __velarLogNativeTypeError = globalThis.TypeError;
const __velarLogNativeRangeError = globalThis.RangeError;
const __velarLogGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarLogGetPrototypeOf = Object.getPrototypeOf;
const __velarLogDefineProperty = Object.defineProperty;
const __velarLogCreateObject = Object.create;
const __velarLogObjectPrototype = Object.prototype;
const __velarLogFreeze = __velarLogGetOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarLogDateNow = __velarLogGetOwnPropertyDescriptor(Date, "now")?.value;
const __velarLogNumberIsFinite = __velarLogGetOwnPropertyDescriptor(Number, "isFinite")?.value;
const __velarLogMathAbs = __velarLogGetOwnPropertyDescriptor(Math, "abs")?.value;
const __velarLogStringTrim = __velarLogGetOwnPropertyDescriptor(String.prototype, "trim")?.value;
const __velarLogStringToLowerCase = __velarLogGetOwnPropertyDescriptor(String.prototype, "toLowerCase")?.value;
const __velarLogPromiseThen = __velarLogGetOwnPropertyDescriptor(Promise.prototype, "then")?.value;
const __velarLogMapSize = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "size")?.get;
const __velarLogMapEntries = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "entries")?.value;
const __velarLogMapHas = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "has")?.value;
const __velarLogMapSet = __velarLogGetOwnPropertyDescriptor(__velarLogNativeMap.prototype, "set")?.value;
const __velarLogSetSize = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "size")?.get;
const __velarLogSetValues = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "values")?.value;
const __velarLogSetHas = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "has")?.value;
const __velarLogSetAdd = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "add")?.value;
const __velarLogSetDelete = __velarLogGetOwnPropertyDescriptor(__velarLogNativeSet.prototype, "delete")?.value;
const __velarLogMapIteratorNext = __velarLogGetOwnPropertyDescriptor(__velarLogGetPrototypeOf(__velarErrorApply(__velarLogMapEntries, new __velarLogNativeMap(), [], "Map.entries")), "next")?.value;
const __velarLogSetIteratorNext = __velarLogGetOwnPropertyDescriptor(__velarLogGetPrototypeOf(__velarErrorApply(__velarLogSetValues, new __velarLogNativeSet(), [], "Set.values")), "next")?.value;
const __velarLogConsoleDescriptor = __velarLogGetOwnPropertyDescriptor(globalThis, "console");
const __velarLogConsoleTarget = __velarLogConsoleDescriptor && "value" in __velarLogConsoleDescriptor
  && __velarLogConsoleDescriptor.value !== null && typeof __velarLogConsoleDescriptor.value === "object"
  ? __velarLogConsoleDescriptor.value : null;
const __velarLogConsoleMethods = __velarLogConsoleTarget === null ? null : __velarLogFreezeValue({
  debug: __velarLogHostMethod(__velarLogConsoleTarget, "debug"),
  info: __velarLogHostMethod(__velarLogConsoleTarget, "info"),
  warn: __velarLogHostMethod(__velarLogConsoleTarget, "warn"),
  error: __velarLogHostMethod(__velarLogConsoleTarget, "error"),
  log: __velarLogHostMethod(__velarLogConsoleTarget, "log"),
});
let threshold = "info";
const sinks = new __velarLogNativeSet();
const maxLogFields = 1000;
const maxLogSinks = 1000;
const maximumLogTimestamp = 8_640_000_000_000_000;

function __velarLogApply(operation, receiver, arguments_, label) { return __velarErrorApply(operation, receiver, arguments_, label); }
function __velarLogFreezeValue(value) { return __velarLogApply(__velarLogFreeze, __velarLogNativeObject, [value], "Object.freeze"); }
function __velarLogMapValue(map, operation, arguments_, label) { return __velarLogApply(operation, map, arguments_, label); }
function __velarLogSetValue(set, operation, arguments_, label) { return __velarLogApply(operation, set, arguments_, label); }
function __velarLogCreateMap() { return new __velarLogNativeMap(); }
function __velarLogMapCount(map) { return __velarLogMapValue(map, __velarLogMapSize, [], "Map.size"); }
function __velarLogMapItems(map) {
  const iterator = __velarLogMapValue(map, __velarLogMapEntries, [], "Map.entries");
  const output = [];
  while (true) {
    const step = __velarLogApply(__velarLogMapIteratorNext, iterator, [], "Map iterator next");
    if (step.done) return output;
    output[output.length] = step.value;
  }
}
function __velarLogSetItems(set) {
  const iterator = __velarLogSetValue(set, __velarLogSetValues, [], "Set.values");
  const output = [];
  while (true) {
    const step = __velarLogApply(__velarLogSetIteratorNext, iterator, [], "Set iterator next");
    if (step.done) return output;
    output[output.length] = step.value;
  }
}
function __velarLogCloneMap(value) {
  const output = __velarLogCreateMap();
  const items = __velarLogMapItems(value);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    __velarLogMapValue(output, __velarLogMapSet, [pair[0], pair[1]], "Map.set");
  }
  return output;
}
function __velarLogHostMethod(target, name) {
  let owner = target;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarLogGetOwnPropertyDescriptor(owner, name);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarLogNativeTypeError("Host console method " + name + " must be a data function");
      return descriptor.value;
    }
    owner = __velarLogGetPrototypeOf(owner);
  }
  return null;
}
function __velarLogFieldsObject(fields) {
  const output = __velarLogApply(__velarLogCreateObject, __velarLogNativeObject, [__velarLogObjectPrototype], "Object.create");
  const items = __velarLogMapItems(fields);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    __velarLogApply(__velarLogDefineProperty, __velarLogNativeObject, [output, pair[0], { value: pair[1], enumerable: true, configurable: true, writable: true }], "Object.defineProperty");
  }
  return output;
}
function logText(value, name, maximum = 65536) { if (typeof value !== "string") throw new __velarLogNativeTypeError(name + " must be a string"); if (value.length > maximum) throw new __velarLogNativeRangeError(name + " is too long"); return value; }
function logTimestamp() {
  const value = __velarLogApply(__velarLogDateNow, __velarLogNativeDate, [], "Date.now");
  if (!__velarLogApply(__velarLogNumberIsFinite, __velarLogNativeNumber, [value], "Number.isFinite")) throw new __velarLogNativeTypeError("The host clock must return a finite timestamp");
  if (__velarLogApply(__velarLogMathAbs, __velarLogNativeMath, [value], "Math.abs") > maximumLogTimestamp) throw new __velarLogNativeRangeError("The host clock returned a timestamp outside the JavaScript date range");
  return value;
}

function fieldsOf(value) {
  if (value == null) return __velarLogCreateMap();
  let size;
  try { size = __velarLogMapCount(value); }
  catch { throw new __velarLogNativeTypeError("VelarScript log fields must be a Map"); }
  if (size > maxLogFields) throw new __velarLogNativeRangeError("VelarScript log fields cannot exceed 1000 entries");
  const fields = __velarLogCreateMap();
  const items = __velarLogMapItems(value);
  for (let index = 0; index < items.length; index += 1) {
    const pair = items[index];
    const key = pair[0];
    if (typeof key !== "string") throw new __velarLogNativeTypeError("VelarScript log field names must be strings");
    if (key.length > 1024) throw new __velarLogNativeRangeError("VelarScript log field names cannot exceed 1024 characters");
    __velarLogMapValue(fields, __velarLogMapSet, [key, pair[1]], "Map.set");
  }
  return fields;
}

function defaultSink(record) {
  if (!__velarLogConsoleDescriptor) return;
  if (__velarLogConsoleTarget === null) throw new __velarLogNativeTypeError("Host console must be an own data object");
  const write = __velarLogConsoleMethods[record.level] ?? __velarLogConsoleMethods.log;
  if (!write) throw new __velarLogNativeTypeError("Host console must provide a callable log method");
  __velarLogApply(write, __velarLogConsoleTarget, [record.scope ? "[" + record.scope + "] " + record.message : record.message, __velarLogFieldsObject(record.fields), record.error ?? ""], "console writer");
}

function sinkFailure(value) {
  const error = __velarNormalizeError(value);
  defaultSink(__velarLogFreezeValue({ timestamp: logTimestamp(), level: "error", scope: "velar/log", message: "Log sink failed", fields: __velarLogCreateMap(), error }));
}
function observeSinkResult(value) {
  try { __velarLogApply(__velarLogPromiseThen, value, [undefined, sinkFailure], "Promise.then"); }
  catch { /* Non-Promise sink results are intentionally ignored. */ }
}

function emit(scope, level, message, fields, error = null) {
  message = logText(message, "Log message");
  fields = fieldsOf(fields);
  if (error != null && !__velarIsError(error)) throw new __velarLogNativeTypeError("Logger error must be an Error");
  if (__velarLogRank(level) < __velarLogRank(threshold)) return null;
  const record = __velarLogFreezeValue({ timestamp: logTimestamp(), level, scope, message, fields, error });
  if (__velarLogSetValue(sinks, __velarLogSetSize, [], "Set.size") === 0) defaultSink(record);
  else {
    const activeSinks = __velarLogSetItems(sinks);
    for (let index = 0; index < activeSinks.length; index += 1) {
      const sink = activeSinks[index];
    try {
      const delivered = __velarLogFreezeValue({ timestamp: record.timestamp, level: record.level, scope: record.scope, message: record.message, fields: __velarLogCloneMap(record.fields), error: record.error });
      const result = sink(delivered);
      observeSinkResult(result);
    } catch (failure) { sinkFailure(failure); }
    }
  }
  return null;
}

function __velarLogRank(value) {
  if (value === "debug") return 10;
  if (value === "info") return 20;
  if (value === "warn") return 30;
  if (value === "error") return 40;
  if (value === "silent") return 100;
  return 100;
}
function createLogger(scope, base = null) {
  const context = fieldsOf(base);
  const debugRank = __velarLogRank("debug");
  const infoRank = __velarLogRank("info");
  const warnRank = __velarLogRank("warn");
  const errorRank = __velarLogRank("error");
  const merged = (fields) => {
    const output = __velarLogCloneMap(context);
    const items = __velarLogMapItems(fieldsOf(fields));
    for (let index = 0; index < items.length; index += 1) {
      const pair = items[index];
      const key = pair[0];
      if (!__velarLogMapValue(output, __velarLogMapHas, [key], "Map.has") && __velarLogMapCount(output) >= maxLogFields) throw new __velarLogNativeRangeError("Merged log fields cannot exceed 1000 entries");
      __velarLogMapValue(output, __velarLogMapSet, [key, pair[1]], "Map.set");
    }
    return output;
  };
  // A call below the active level returns before it builds anything: the
  // context is not merged, the message and fields are not validated, and no
  // bound is checked, so turning a level off is both free and side-effect-free.
  // 'threshold' is read per call, so 'setLevel' keeps reaching loggers that
  // already exist. The gate inside 'emit' stays as the belt to these braces.
  return __velarLogFreezeValue({
    debug(message, fields = null) { if (debugRank < __velarLogRank(threshold)) return null; return emit(scope, "debug", message, merged(fields)); },
    info(message, fields = null) { if (infoRank < __velarLogRank(threshold)) return null; return emit(scope, "info", message, merged(fields)); },
    warn(message, fields = null) { if (warnRank < __velarLogRank(threshold)) return null; return emit(scope, "warn", message, merged(fields)); },
    error(message, error = null, fields = null) { if (errorRank < __velarLogRank(threshold)) return null; return emit(scope, "error", message, merged(fields), error); },
  });
}

function __velarLogRecordField(value, name) {
  const descriptor = __velarLogGetOwnPropertyDescriptor(value, name);
  if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  return descriptor.value;
}
function __velarLogRecordValue(value) {
  if (!value || typeof value !== "object" || __velarLogGetPrototypeOf(value) !== __velarLogObjectPrototype) {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  const timestamp = __velarLogRecordField(value, "timestamp");
  if (typeof timestamp !== "number"
    || !__velarLogApply(__velarLogNumberIsFinite, __velarLogNativeNumber, [timestamp], "Number.isFinite")
    || __velarLogApply(__velarLogMathAbs, __velarLogNativeMath, [timestamp], "Math.abs") > maximumLogTimestamp) {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  const level = __velarLogRecordField(value, "level");
  if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
    throw new __velarLogNativeTypeError("Value does not match LogRecord");
  }
  logText(__velarLogRecordField(value, "scope"), "LogRecord scope", 1024);
  logText(__velarLogRecordField(value, "message"), "LogRecord message");
  const error = __velarLogRecordField(value, "error");
  if (error !== null && !__velarIsError(error)) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  const fields = __velarLogRecordField(value, "fields");
  if (fields == null) throw new __velarLogNativeTypeError("Value does not match LogRecord");
  fieldsOf(fields);
  return value;
}

// D59 rule 145.3 and D65 rule 171: the record 'useSink' hands to a sink now
// has a published name, so a sink can be a named 'def' with an annotated
// parameter. An exported type name is a runtime value in VelarScript — the
// emitter proves it for every 'export type' — so the name ships the same
// frozen 'is'/'parse' pair 'velar/fs' publishes for FileWatchBatch.
export const LogRecord = __velarLogFreezeValue({
  is(value) { try { __velarLogRecordValue(value); return true; } catch { return false; } },
  parse(value) { return __velarLogRecordValue(value); },
});

export const log = createLogger("");
export function logger(scope, fields = null) {
  const name = __velarLogApply(__velarLogStringTrim, logText(scope, "Logger scope", 1024), [], "String.trim");
  if (!name) throw new __velarLogNativeTypeError("A VelarScript logger requires a non-empty scope");
  return createLogger(name, fields);
}
export function level() { return threshold; }
export function setLevel(value) {
  const next = __velarLogApply(__velarLogStringToLowerCase, logText(value, "Log level"), [], "String.toLowerCase");
  if (next !== "debug" && next !== "info" && next !== "warn" && next !== "error" && next !== "silent") throw new __velarLogNativeTypeError("Log level must be debug, info, warn, error, or silent");
  threshold = next;
  return null;
}
export function useSink(sink) {
  if (typeof sink !== "function") throw new __velarLogNativeTypeError("A VelarScript log sink must be callable");
  if (!__velarLogSetValue(sinks, __velarLogSetHas, [sink], "Set.has") && __velarLogSetValue(sinks, __velarLogSetSize, [], "Set.size") >= maxLogSinks) throw new __velarLogNativeRangeError("VelarScript logging cannot install more than 1000 sinks");
  __velarLogSetValue(sinks, __velarLogSetAdd, [sink], "Set.add");
  return () => { __velarLogSetValue(sinks, __velarLogSetDelete, [sink], "Set.delete"); return null; };
}
