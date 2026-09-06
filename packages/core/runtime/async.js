const __velarMaxTimerMilliseconds = 2147483647;
const __velarMaxAsyncFanout = 10000;
const __velarAsyncGlobal = globalThis;
const __velarAsyncApply = Reflect.apply;
const __velarAsyncPromise = Promise;
const __velarAsyncPromiseThen = Promise.prototype.then;
const __velarAsyncSetTimeout = globalThis.setTimeout;
const __velarAsyncClearTimeout = globalThis.clearTimeout;
const __velarAsyncNumber = Number;
const __velarAsyncNumberIsFinite = Number.isFinite;
const __velarAsyncNumberIsSafeInteger = Number.isSafeInteger;
const __velarAsyncRegExpExec = RegExp.prototype.exec;
const __velarAsyncDurationPattern = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/;
const __velarAsyncGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
// D51 rule 103: the same list the \`try\` expression refuses to swallow. A
// combinator that turns a failure into a value — or retries past it — must not
// hide the language saying "this program has a bug".
function __velarAsyncIsIntegrityFailure(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  const descriptor = __velarAsyncGetOwnPropertyDescriptor(value, "name");
  if (!descriptor || !("value" in descriptor)) return false;
  const name = descriptor.value;
  return name === "AssertionError" || name === "NarrowingError" || name === "IndexError";
}
const __velarAsyncGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarAsyncGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const __velarAsyncGetPrototypeOf = Object.getPrototypeOf;
const __velarAsyncCreate = Object.create;
const __velarAsyncDefineProperty = Object.defineProperty;
const __velarAsyncTypeError = TypeError;
const __velarAsyncRangeError = RangeError;
const __velarAsyncError = Error;
const __velarAsyncDetachedRegistryKey = Symbol.for("velar.runtime.v1");
const __velarAsyncConsole = globalThis.console;
const __velarAsyncConsoleError = __velarAsyncConsole ? __velarAsyncConsole.error : null;
function asyncFanout(values, name) { values = __velarRequireList(values, name); if (values.length > __velarMaxAsyncFanout) throw new __velarAsyncRangeError(name + " cannot start more than 10000 operations at once"); return values; }
function durationMilliseconds(value, name) { if (typeof value !== "string") throw new __velarAsyncTypeError(name + " requires Duration; write a value such as 200ms or 2s"); const match = __velarAsyncApply(__velarAsyncRegExpExec, __velarAsyncDurationPattern, [value]); if (!match) throw new __velarAsyncTypeError(name + " requires Duration; write a value such as 200ms or 2s"); const milliseconds = __velarAsyncNumber(match[1]) * (match[2] === "s" ? 1000 : 1); if (!__velarAsyncNumberIsFinite(milliseconds) || milliseconds < 0 || milliseconds > __velarMaxTimerMilliseconds) throw new __velarAsyncRangeError(name + " requires a Duration from 0ms through 2147483647ms"); return milliseconds; }
export function sleep(duration) { const milliseconds = durationMilliseconds(duration, "sleep"); return new __velarAsyncPromise((resolve) => __velarAsyncApply(__velarAsyncSetTimeout, __velarAsyncGlobal, [() => resolve(null), milliseconds])); }
function normalize(value) { return value === undefined ? null : value; }
function reportAsyncLoser(failure) { try { const runtime = globalThis[__velarAsyncDetachedRegistryKey]; if (runtime && typeof runtime.report === "function") { runtime.report(failure, { phase: "detached", detail: "async combinator loser", unhandled: true }); return null; } if (typeof __velarAsyncConsoleError === "function") __velarAsyncApply(__velarAsyncConsoleError, __velarAsyncConsole, ["Detached task failed: " + (failure && failure.stack ? failure.stack : String(failure))]); } catch {} return null; }
function actualPromise(value, name) { try { return __velarAsyncApply(__velarAsyncPromiseThen, value, [normalize]); } catch { throw new __velarAsyncTypeError(name + " requires actual Promises"); } }
function optionalActualPromise(value) { try { return __velarAsyncApply(__velarAsyncPromiseThen, value, [normalize]); } catch { return null; } }
function promiseList(values, name) { const output = new __velarListArray(values.length); for (let index = 0; index < values.length; index += 1) output[index] = actualPromise(values[index], name); return output; }
function promiseAll(values) {
  return new __velarAsyncPromise((resolve, reject) => {
    const output = new __velarListArray(values.length);
    if (values.length === 0) { resolve(output); return; }
    let remaining = values.length;
    let settled = false;
    for (let index = 0; index < values.length; index += 1) {
      try {
        __velarAsyncApply(__velarAsyncPromiseThen, values[index], [
          (value) => { output[index] = value; remaining -= 1; if (remaining === 0 && !settled) { settled = true; resolve(output); } },
          (failure) => { if (settled) reportAsyncLoser(failure); else { settled = true; reject(failure); } },
        ]);
      } catch (error) { if (settled) reportAsyncLoser(error); else { settled = true; reject(error); } }
    }
  });
}
function promiseRace(values) {
  return new __velarAsyncPromise((resolve, reject) => {
    let settled = false;
    for (let index = 0; index < values.length; index += 1) {
      try { __velarAsyncApply(__velarAsyncPromiseThen, values[index], [(value) => { if (!settled) { settled = true; resolve(value); } }, (failure) => { if (settled) reportAsyncLoser(failure); else { settled = true; reject(failure); } }]); }
      catch (error) { if (settled) reportAsyncLoser(error); else { settled = true; reject(error); } }
    }
  });
}
function requireSafePromiseResult(value, name) {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
  let owner = value;
  for (let depth = 0; owner !== null && depth < 128; depth += 1) {
    let descriptor;
    try { descriptor = __velarAsyncGetOwnPropertyDescriptor(owner, "then"); }
    catch { throw new __velarAsyncTypeError(name + " result must not expose a callable 'then' or a 'then' getter"); }
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value === "function") throw new __velarAsyncTypeError(name + " result must not expose a callable 'then' or a 'then' getter");
      return value;
    }
    try { owner = __velarAsyncGetPrototypeOf(owner); }
    catch { throw new __velarAsyncTypeError(name + " result must have an inspectable prototype chain"); }
  }
  if (owner !== null) throw new __velarAsyncTypeError(name + " result prototype chain is too deep");
  return value;
}
function promiseRecord(value, name) { if (value === null || typeof value !== "object" || __velarListArrayIsArray(value) || __velarAsyncGetOwnPropertySymbols(value).length > 0) throw new __velarAsyncTypeError(name + " requires a List or record of Promises"); const names = __velarAsyncGetOwnPropertyNames(value); if (names.length > __velarMaxAsyncFanout) throw new __velarAsyncRangeError(name + " cannot start more than 10000 operations at once"); const promises = new __velarListArray(names.length); for (let index = 0; index < names.length; index += 1) { const descriptor = __velarAsyncGetOwnPropertyDescriptor(value, names[index]); if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new __velarAsyncTypeError(name + " record fields must be enumerable data values"); promises[index] = actualPromise(descriptor.value, name); } return __velarAsyncApply(__velarAsyncPromiseThen, promiseAll(promises), [(results) => { const output = __velarAsyncCreate(null); for (let index = 0; index < names.length; index += 1) __velarAsyncDefineProperty(output, names[index], { value: results[index], enumerable: true, configurable: true, writable: true }); return output; }]); }
export async function all(values) { if (__velarListArrayIsArray(values)) { values = asyncFanout(values, "async.all"); return promiseAll(promiseList(values, "async.all")); } return promiseRecord(values, "async.all"); }
export async function race(values) { values = asyncFanout(values, "async.race"); if (values.length === 0) throw new __velarAsyncRangeError("race requires at least one Promise"); return promiseRace(promiseList(values, "async.race")); }
export async function timeout(value, duration, message = "Operation timed out") { value = actualPromise(value, "async.timeout"); const milliseconds = durationMilliseconds(duration, "timeout"); if (typeof message !== "string") throw new __velarAsyncTypeError("timeout message must be a string"); if (message.length > 65536) throw new __velarAsyncRangeError("timeout messages cannot exceed 64 KiB"); let timer; const timeoutPromise = new __velarAsyncPromise((_, reject) => { timer = __velarAsyncApply(__velarAsyncSetTimeout, __velarAsyncGlobal, [() => reject(new TimeoutError(message)), milliseconds]); }); try { return normalize(await promiseRace([value, timeoutPromise])); } finally { if (timer !== undefined) __velarAsyncApply(__velarAsyncClearTimeout, __velarAsyncGlobal, [timer]); } }
export async function retry(task, attempts = 3, delay = "0ms") { if (typeof task !== "function") throw new __velarAsyncTypeError("retry requires a function"); if (!__velarAsyncNumberIsSafeInteger(attempts) || attempts < 1 || attempts > 10000) throw new __velarAsyncRangeError("retry attempts must be an integer from 1 through 10000"); durationMilliseconds(delay, "retry delay"); let last; for (let attempt = 0; attempt < attempts; attempt += 1) { try { const candidate = normalize(__velarAsyncApply(task, undefined, [])); const pending = optionalActualPromise(candidate); return pending ? await pending : requireSafePromiseResult(candidate, "async.retry"); } catch (error) { if (__velarAsyncIsIntegrityFailure(error)) throw error; last = error; if (attempt + 1 < attempts && delay !== "0ms") await sleep(delay); } } throw last; }
export async function map(values, worker, concurrency = 4) { values = __velarRequireList(values, "async.map"); if (typeof worker !== "function") throw new __velarAsyncTypeError("async.map requires a worker"); if (!__velarAsyncNumberIsSafeInteger(concurrency) || concurrency < 1 || concurrency > 1024) throw new __velarAsyncRangeError("async.map concurrency must be an integer from 1 through 1024"); const output = new __velarListArray(values.length); let cursor = 0, stopped = false; async function run() { try { while (!stopped) { const index = cursor++; if (index >= values.length) return null; const candidate = normalize(__velarAsyncApply(worker, undefined, [values[index]])); const pending = optionalActualPromise(candidate); output[index] = pending ? await pending : candidate; } return null; } catch (failure) { stopped = true; throw failure; } } const workerCount = concurrency < values.length ? concurrency : values.length; const workers = new __velarListArray(workerCount); for (let index = 0; index < workerCount; index += 1) workers[index] = run(); await promiseAll(workers); return output; }
export async function series(tasks) { tasks = __velarRequireList(tasks, "async.series"); const output = new __velarListArray(tasks.length); for (let index = 0; index < tasks.length; index += 1) { const task = tasks[index]; if (typeof task !== "function") throw new __velarAsyncTypeError("series requires a List of functions"); const candidate = normalize(__velarAsyncApply(task, undefined, [])); const pending = optionalActualPromise(candidate); output[index] = pending ? await pending : candidate; } return output; }
