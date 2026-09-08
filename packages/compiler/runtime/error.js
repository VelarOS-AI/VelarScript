const __velarErrorNativeError = globalThis.Error;
const __velarErrorNativeString = globalThis.String;
const __velarErrorNativeObject = globalThis.Object;
const __velarErrorNativeReflect = globalThis.Reflect;
const __velarErrorNativeTypeError = globalThis.TypeError;
const __velarErrorGetOwnPropertyDescriptor = __velarErrorNativeObject.getOwnPropertyDescriptor;
const __velarErrorGetPrototypeOf = __velarErrorNativeObject.getPrototypeOf;
const __velarErrorReflectApply = __velarErrorGetOwnPropertyDescriptor(__velarErrorNativeReflect, "apply")?.value;
const __velarErrorIsErrorOperation = __velarErrorGetOwnPropertyDescriptor(__velarErrorNativeError, "isError")?.value;
const __velarErrorArrayIsArray = globalThis.Array.isArray;
const __velarErrorStackGetter = __velarErrorGetOwnPropertyDescriptor(new __velarErrorNativeError(), "stack")?.get;
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
// One frame policy for run, test, and the emitted host-error channels. Helpers
// inlined into a source-mapped module are still runtime code: their reserved
// names, not their paths, identify them. Only the compiler's exact test entry
// name denotes authored source despite that prefix.
const __velarHostErrorInternalFrame = /(?:^|\s|\()node:[a-z_]+(?:\/|:)/u;
const __velarHostErrorRuntimeFrame = /\bat\s(?:async\s)?(?:new\s)?(?:[^\s(]*\.)?__[Vv]elar/u;
const __velarHostErrorPosition = /\(?([^()]+):(\d+):(\d+)\)?$/u;
function __velarHostErrorFrame(line) {
  return /^\s+at\s/u.test(line) || /^[^@\n]*@.+:\d+:\d+$/u.test(line);
}
function __velarHostErrorFramePosition(line) {
  const text = line.trimEnd();
  const position = __velarHostErrorPosition.exec(text);
  if (!position) return null;
  const path = position[1].replace(/^\s*at\s+(?:async\s+)?/u, "").replace(/^[^@]*@/u, "");
  const row = Number(position[2]);
  const column = Number(position[3]);
  if (!Number.isSafeInteger(row) || row < 1 || !Number.isSafeInteger(column) || column < 1) return null;
  return { path, line: row, column };
}
function __velarHostErrorOwnedFrame(line, runtimeRoots = []) {
  const portable = line.replaceAll("\\", "/");
  const path = __velarHostErrorFramePosition(portable)?.path;
  if (path !== undefined && runtimeRoots.some((root) => path.startsWith(root))) return false;
  if (__velarHostErrorInternalFrame.test(portable) || portable.includes("/node_modules/velar/")) return false;
  const runtime = __velarHostErrorRuntimeFrame.test(portable) || /^(?:[^@.]+\.)?__[Vv]elar[^@]*@/u.test(portable);
  if (!runtime) return true;
  return /^(?:\s+at\s+(?:async\s+)?__velarTest\d+\s+\(|__velarTest\d+@)/u.test(portable)
    && __velarHostErrorFramePosition(portable)?.path.endsWith(".vel") === true;
}
function __velarHostErrorPortableFrame(line) {
  return line.replaceAll("\\", "/")
    .replace(/(\bat\s+(?:async\s+)?)__velarTest\d+(?=\s)/u, "$1<test>")
    .replace(/^__velarTest\d+@/u, "<test>@");
}
function __velarHostErrorPresentation(trace, fullStack = false, excluded = [], runtimeRoots = []) {
  const lines = trace.slice(0, 64 * 1024).split("\n");
  const frames = lines.filter((line) => __velarHostErrorFrame(line) && !excluded.some((path) => line.includes(path)))
    .filter((line, index, all) => line !== all[index - 1]);
  const owned = frames.filter((line) => __velarHostErrorOwnedFrame(line, runtimeRoots));
  return {
    header: lines.filter((line) => !__velarHostErrorFrame(line)),
    frames: (fullStack ? frames : owned).map(__velarHostErrorPortableFrame),
    snippet: owned[0],
    hidden: fullStack ? 0 : frames.length - owned.length,
  };
}
function __velarHostErrorCommand(command) {
  return command === "velar run" || command === "velar test" || command === "velar test --browser";
}
function __velarHostErrorSummary(hidden, command) {
  const hint = __velarHostErrorCommand(command)
    ? "; rerun with '" + command + " --stack' for the full trace" : "";
  return "  (" + hidden + " frame" + (hidden === 1 ? "" : "s") + " outside your program hidden" + hint + ")";
}
// The launcher supplies a checked command as well as the flag: a test must not
// suggest rerunning a different command. No launcher context means a built app
// keeps its raw trace. Read data descriptors rather than invoking host getters.
function __velarHostErrorContext() {
  try {
    const property = __velarErrorGetOwnPropertyDescriptor(globalThis, Symbol.for("velar.run.stack"));
    const value = property && "value" in property ? property.value : null;
    if (value === false || value === true) return { fullStack: value, command: "velar run", runtimeRoots: [] };
    if (value === null || typeof value !== "object") return null;
    const stack = __velarErrorGetOwnPropertyDescriptor(value, "fullStack");
    const command = __velarErrorGetOwnPropertyDescriptor(value, "command");
    if (!stack || !("value" in stack) || typeof stack.value !== "boolean"
      || !command || !("value" in command) || !__velarHostErrorCommand(command.value)) return null;
    const runtimeRoots = __velarHostErrorRuntimeRoots(value);
    return runtimeRoots === null ? null : { fullStack: stack.value, command: command.value, runtimeRoots };
  } catch { return null; }
}
// Only Node test owners supply their own installation directory. Built pages
// receive no host paths. The optional list is bounded and never reads getters.
function __velarHostErrorRuntimeRoots(context) {
  const property = __velarErrorGetOwnPropertyDescriptor(context, "runtimeRoots");
  if (!property) return [];
  if (!("value" in property) || !__velarErrorArrayIsArray(property.value)) return null;
  const entries = property.value;
  const length = __velarErrorGetOwnPropertyDescriptor(entries, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 8) return null;
  const roots = [];
  for (let index = 0; index < length; index += 1) {
    const entry = __velarErrorGetOwnPropertyDescriptor(entries, __velarErrorNativeString(index));
    if (!entry || !("value" in entry) || typeof entry.value !== "string"
      || entry.value.length > 4096 || !entry.value.endsWith("/")) return null;
    roots.push(entry.value);
  }
  return roots;
}
function __velarHostErrorOwnCause(error) {
  try {
    const cause = __velarErrorGetOwnPropertyDescriptor(error, "cause");
    return cause && "value" in cause ? cause.value : undefined;
  } catch { return undefined; }
}
function __velarHostErrorText(error, name, inherited = false) {
  try {
    for (let current = error, depth = 0; current !== null && depth < 8; depth += 1) {
      const property = __velarErrorGetOwnPropertyDescriptor(current, name);
      if (property) return "value" in property && typeof property.value === "string" ? property.value.slice(0, 64 * 1024) : null;
      if (!inherited) break;
      current = __velarErrorGetPrototypeOf(current);
    }
  } catch {}
  return null;
}
function __velarHostErrorDescription(error) {
  let native = false;
  try { native = __velarIsError(error); } catch {}
  if (!native) {
    if (typeof error === "string") return "The program threw a non-Error string value: " + error.slice(0, 64 * 1024);
    return "The program threw a non-Error " + (error === null ? "null" : typeof error) + " value";
  }
  const name = __velarHostErrorText(error, "name", true);
  const message = __velarHostErrorText(error, "message", true);
  let stack = __velarHostErrorText(error, "stack");
  if (stack === null && name !== null && message !== null && typeof __velarErrorStackGetter === "function") {
    // V8's stack is an own accessor. Invoke the captured native getter, never
    // an accessor supplied by the thrown value, and guard custom preparation.
    try {
      const value = __velarErrorApply(__velarErrorStackGetter, error, [], "Error.stack");
      if (typeof value === "string") stack = value.slice(0, 64 * 1024);
    } catch {}
  }
  if (stack !== null && stack !== "") return stack;
  return (name || "Error") + ": " + (message || "An Error was thrown without a message");
}
function __velarHostErrorTrace(error, fallback) {
  const trace = __velarHostErrorDescription(error) || fallback;
  const context = __velarHostErrorContext();
  if (context === null) return trace;
  const presentation = __velarHostErrorPresentation(trace, context.fullStack, [], context.runtimeRoots);
  return presentation.header.concat(presentation.frames,
    presentation.hidden > 0 ? [__velarHostErrorSummary(presentation.hidden, context.command)] : []).join("\n");
}
