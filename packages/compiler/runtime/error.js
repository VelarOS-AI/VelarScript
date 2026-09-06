const __velarErrorNativeError = globalThis.Error;
const __velarErrorNativeString = globalThis.String;
const __velarErrorNativeObject = globalThis.Object;
const __velarErrorNativeReflect = globalThis.Reflect;
const __velarErrorNativeTypeError = globalThis.TypeError;
const __velarErrorGetOwnPropertyDescriptor = __velarErrorNativeObject.getOwnPropertyDescriptor;
const __velarErrorGetPrototypeOf = __velarErrorNativeObject.getPrototypeOf;
const __velarErrorReflectApply = __velarErrorGetOwnPropertyDescriptor(__velarErrorNativeReflect, "apply")?.value;
const __velarErrorIsErrorOperation = __velarErrorGetOwnPropertyDescriptor(__velarErrorNativeError, "isError")?.value;
function __velarErrorApply(operation, receiver, arguments_, label) {
  if (typeof operation !== "function" || typeof __velarErrorReflectApply !== "function") {
    throw new __velarErrorNativeTypeError("The JavaScript " + label + " API is unavailable");
  }
  return __velarErrorReflectApply(operation, receiver, arguments_);
}
function __velarIsError(value) {
  return __velarErrorApply(__velarErrorIsErrorOperation, __velarErrorNativeError, [value], "Error.isError");
}
// D50 rule 89: 'code' is the string projection of an error's declared class,
// never a second taxonomy. The class lowering writes the declared name into
// the instance's own 'name' property (rule 74), and this reads exactly that
// property back — one source of truth, so the two can never diverge. A value
// no Velar class declared (a host TypeError, a foreign Error) reports the base
// contract it actually satisfies: "Error".
//
// D51 rule 107: 'is' is the only discrimination authority, so the own 'name'
// counts only when the class the value was constructed from declares that same
// name. A JavaScript caller writing e.name = "FileNotFoundError" on a host
// TypeError produced an error whose 'code' said FileNotFoundError while 'is'
// said false; the class behind the value is what answers now.
function __velarErrorCode(value) {
  if (value === null || typeof value !== "object" && typeof value !== "function") return "Error";
  const descriptor = __velarErrorGetOwnPropertyDescriptor(value, "name");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.length === 0) return "Error";
  const prototype = __velarErrorGetPrototypeOf(value);
  const constructor = prototype === null ? null : __velarErrorGetOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function") return "Error";
  const declared = __velarErrorGetOwnPropertyDescriptor(constructor.value, "name");
  return declared && "value" in declared && declared.value === descriptor.value ? descriptor.value : "Error";
}
function __velarNormalizeError(value) {
  if (__velarIsError(value)) return value;
  const kind = typeof value;
  let message;
  if (kind === "string") message = value;
  else if (value === null) message = "null";
  else if (kind === "undefined") message = "undefined";
  else if (kind === "number" || kind === "boolean" || kind === "bigint" || kind === "symbol") {
    message = __velarErrorApply(__velarErrorNativeString, globalThis, [value], "String");
  }
  else message = "A non-Error value was thrown by JavaScript";
  return new __velarErrorNativeError(message, { cause: value });
}
// AS-I1 + PR-U4 + CO-I6 + CO-U2: one frame policy, one implementation.
//
// Everything `velar run` prints goes through this: the uncaught path in the
// launcher (packages/cli/src/uncaught-program-error.ts), the emitted host error
// channel (a detached task's failure, a release that failed while another error
// was in flight), and the Core runtime's own detached reporter in
// packages/core/runtime/async.js — which used to write `failure.stack`
// unfiltered, so `Promise.timeout` nested twice printed three internal frames
// and ignored `--stack`, under a sentence that promised the opposite.
//
// A frame is the author's unless it is Node's own, or the language runtime's.
// CO-U2: the runtime is recognized by the reserved name prefix its helpers
// carry — a spelling no source may bind — rather than by the file it sits in,
// because the compiler inlines those helpers into the program's own module,
// where a path test left the required-value helper's own frame on screen,
// pointing into a sandbox directory the run had already deleted. The shipped
// runtime modules are matched by the package that serves them, because their
// frames are anonymous callbacks that carry no name to match.
//
// The switch is a global the `velar run` launcher sets (the same `--stack` value
// it compiles in). Absent — a built application, a test harness, any host that
// is not that launcher — the trace is passed through untouched, because the line
// that names `velar run --stack` would then name a command nobody ran.
const __velarHostErrorInternalFrame = /(?:^|\s|\()node:[a-z_]+(?:\/|:)/u;
const __velarHostErrorRuntimeFrame = /\bat\s(?:async\s)?(?:new\s)?(?:[^\s(]*\.)?__[Vv]elar/u;
function __velarHostErrorOwnedFrame(line) {
  return !__velarHostErrorInternalFrame.test(line)
    && !__velarHostErrorRuntimeFrame.test(line)
    && !line.includes("/node_modules/velar/");
}
function __velarHostErrorTrace(error, fallback) {
  let trace = null;
  try { const stack = error.stack; if (typeof stack === "string" && stack !== "") trace = stack; } catch {}
  if (trace === null) {
    try { const message = error.message; if (typeof message === "string" && message !== "") return message; } catch {}
    return fallback;
  }
  let hiding = false;
  try { hiding = globalThis[Symbol.for("velar.run.stack")] === false; } catch {}
  if (!hiding) return trace;
  const lines = trace.split("\n");
  const frames = lines.filter((line) => /^\s+at\s/u.test(line));
  const owned = frames.filter(__velarHostErrorOwnedFrame);
  const hidden = frames.length - owned.length;
  if (hidden === 0) return trace;
  const kept = lines.filter((line) => !/^\s+at\s/u.test(line)).concat(owned);
  kept.push("  (" + hidden + " Node.js internal frame" + (hidden === 1 ? "" : "s") + " hidden; rerun with 'velar run --stack' for the full trace)");
  return kept.join("\n");
}
