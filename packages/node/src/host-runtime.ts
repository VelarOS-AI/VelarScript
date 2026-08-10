// Canonical Node lifecycle boundary. It captures the signal, exit, timer,
// Promise and diagnostic operations used by velar/host before application code
// can replace their public properties or prototypes.
export const VELAR_NODE_HOST_RUNTIME = String.raw`
import { writeSync as __velarHostWriteSync } from "node:fs";

const __velarHostNativeArray = globalThis.Array;
const __velarHostNativeDate = globalThis.Date;
const __velarHostNativeError = globalThis.Error;
const __velarHostNativeNumber = globalThis.Number;
const __velarHostNativeObject = globalThis.Object;
const __velarHostNativePromise = globalThis.Promise;
const __velarHostNativeRangeError = globalThis.RangeError;
const __velarHostNativeReflect = globalThis.Reflect;
const __velarHostNativeTypeError = globalThis.TypeError;
const __velarHostOwnDescriptor = __velarHostNativeObject.getOwnPropertyDescriptor;
const __velarHostApply = __velarHostNativeReflect.apply;
function __velarHostDataOperation(target, name) {
  const descriptor = __velarHostOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarHostNativeError("VelarScript host lifecycle operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarHostArrayPush = __velarHostDataOperation(__velarHostNativeArray.prototype, "push");
const __velarHostDateNow = __velarHostDataOperation(__velarHostNativeDate, "now");
const __velarHostNumberIsSafeInteger = __velarHostDataOperation(__velarHostNativeNumber, "isSafeInteger");
const __velarHostPromiseThen = __velarHostDataOperation(__velarHostNativePromise.prototype, "then");
const __velarHostSetTimeout = globalThis.setTimeout;
const __velarHostClearTimeout = globalThis.clearTimeout;
const __velarHostProcess = globalThis.process;
const __velarHostProcessOn = __velarHostProcess.on;
const __velarHostProcessExit = __velarHostProcess.exit;
const __velarHostCleanups = [];
const maxShutdownCleanups = 1024;
const shutdownTimeoutMs = 30000;
let __velarHostListening = false;
let __velarHostShuttingDown = false;

function __velarHostCall(operation, receiver, arguments_) {
  return __velarHostApply(operation, receiver, arguments_);
}

function __velarHostNow() {
  return __velarHostCall(__velarHostDateNow, __velarHostNativeDate, []);
}

function __velarHostExitCode(value) {
  if (!__velarHostCall(__velarHostNumberIsSafeInteger, __velarHostNativeNumber, [value]) || value < 0 || value > 255) {
    throw new __velarHostNativeRangeError("exit code must be an integer from 0 through 255");
  }
  return value;
}

function __velarHostThen(value, fulfilled, rejected) {
  return __velarHostCall(__velarHostPromiseThen, value, [fulfilled, rejected]);
}

function __velarHostErrorMessage(error) {
  if (!error || typeof error !== "object") return "Unknown shutdown failure";
  const descriptor = __velarHostOwnDescriptor(error, "message");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : "Unknown shutdown failure";
}

function __velarHostDiagnostic(message, error = null) {
  const suffix = error === null ? "" : ": " + __velarHostErrorMessage(error);
  __velarHostWriteSync(2, message + suffix + "\n", null, "utf8");
}

function __velarHostDeadline(cleanup, remaining) {
  let timer = null;
  const result = new __velarHostNativePromise((resolve, reject) => {
    timer = __velarHostSetTimeout(
      () => reject(new __velarHostNativeError("Shutdown cleanup timed out after " + shutdownTimeoutMs + " ms")),
      remaining,
    );
    let cleanupResult;
    try { cleanupResult = __velarHostCall(cleanup, undefined, []); }
    catch (error) { reject(error); return; }
    try {
      __velarHostThen(
        cleanupResult,
        value => value === null
          ? resolve(null)
          : reject(new __velarHostNativeTypeError("A shutdown cleanup must resolve to null")),
        reject,
      );
    } catch {
      reject(new __velarHostNativeTypeError("A shutdown cleanup must return a host Promise"));
    }
  });
  return { result, cancel() { if (timer !== null) { __velarHostClearTimeout(timer); timer = null; } } };
}

async function __velarHostShutdown(signal) {
  if (__velarHostShuttingDown) {
    __velarHostCall(__velarHostProcessExit, __velarHostProcess, [signal === "SIGINT" ? 130 : 143]);
    return;
  }
  __velarHostShuttingDown = true;
  let code = signal === "SIGINT" ? 130 : 143;
  const deadline = __velarHostNow() + shutdownTimeoutMs;
  for (let index = 0; index < __velarHostCleanups.length; index += 1) {
    const remaining = deadline - __velarHostNow();
    if (remaining <= 0) {
      code = 1;
      __velarHostDiagnostic("[velar/host] shutdown cleanup deadline exceeded");
      break;
    }
    const pending = __velarHostDeadline(__velarHostCleanups[index], remaining);
    try {
      const result = await pending.result;
      if (result !== null) throw new __velarHostNativeTypeError("A shutdown cleanup must resolve to null");
    } catch (error) {
      code = 1;
      __velarHostDiagnostic("[velar/host] shutdown cleanup failed", error);
      if (__velarHostNow() >= deadline) break;
    } finally {
      pending.cancel();
    }
  }
  __velarHostCall(__velarHostProcessExit, __velarHostProcess, [code]);
}

function __velarHostListen() {
  if (__velarHostListening) return;
  __velarHostListening = true;
  __velarHostCall(__velarHostProcessOn, __velarHostProcess, ["SIGINT", () => { void __velarHostShutdown("SIGINT"); }]);
  __velarHostCall(__velarHostProcessOn, __velarHostProcess, ["SIGTERM", () => { void __velarHostShutdown("SIGTERM"); }]);
}

export function exit(code = 0) {
  __velarHostCall(__velarHostProcessExit, __velarHostProcess, [__velarHostExitCode(code)]);
}

export function onShutdown(cleanup) {
  if (typeof cleanup !== "function") throw new __velarHostNativeTypeError("onShutdown requires an async cleanup function");
  if (__velarHostShuttingDown) throw new __velarHostNativeError("Cannot register a shutdown cleanup after shutdown begins");
  if (__velarHostCleanups.length >= maxShutdownCleanups) {
    throw new __velarHostNativeRangeError("onShutdown cannot register more than 1024 cleanups");
  }
  __velarHostCall(__velarHostArrayPush, __velarHostCleanups, [cleanup]);
  __velarHostListen();
  return null;
}
`.trimStart();
