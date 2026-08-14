export const VELAR_ERROR_NORMALIZATION_RUNTIME = String.raw`
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
`.trimStart();

/**
 * D50 rule 89: the capability failures a caller recovers from differently.
 * Each name has a real throw site behind a standard capability; none exists
 * for symmetry. `path` carries the resource that failed, because every
 * recovery path — create it, ask for permission, pick another name — needs to
 * know which one it was; it is optional because a hand-written instance has no
 * host path to report. AddressInUseError carries no extra field: "pick another
 * port" needs nothing the message does not already say.
 */
export const VELAR_HOST_ERROR_NAMES = [
  "FileNotFoundError",
  "PermissionError",
  "NotADirectoryError",
  "FileExistsError",
  "AddressInUseError",
] as const;

export const VELAR_HOST_ERROR_PATH_NAMES: readonly string[] = VELAR_HOST_ERROR_NAMES
  .filter((name) => name !== "AddressInUseError");

export const VELAR_HOST_ERROR_RUNTIME = String.raw`
const __velarHostErrorNativeError = globalThis.Error;
const __velarHostErrorDefineProperty = globalThis.Object.defineProperty;
${VELAR_HOST_ERROR_NAMES.map((name) => VELAR_HOST_ERROR_PATH_NAMES.includes(name)
  ? `class __Velar${name} extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = ${JSON.stringify(name)};
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__Velar${name}, "name", { value: ${JSON.stringify(name)}, writable: false, enumerable: false, configurable: true });`
  : `class __Velar${name} extends __velarHostErrorNativeError {
  constructor(message) {
    super(message);
    this.name = ${JSON.stringify(name)};
  }
}
__velarHostErrorDefineProperty(__Velar${name}, "name", { value: ${JSON.stringify(name)}, writable: false, enumerable: false, configurable: true });`).join("\n")}
`.trimStart();

export const VELAR_ERROR_NORMALIZATION_MODULE = "velar/compiler-runtime-errors-v1";

/** Project-shared implementation of compiler-owned foreign Error normalization. */
export const VELAR_ERROR_NORMALIZATION_MODULE_SOURCE = String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
${VELAR_HOST_ERROR_RUNTIME}
export {
  __velarErrorApply as errorApply,
  __velarErrorCode as errorCode,
  __velarIsError as isError,
  __velarNormalizeError as normalizeError,
  ${VELAR_HOST_ERROR_NAMES.map((name) => `__Velar${name} as ${name},`).join("\n  ")}
};
`.trimStart();
