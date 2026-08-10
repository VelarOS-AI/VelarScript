export const VELAR_NARROWING_MODULE = "velar/compiler-runtime-narrowing-v1";

/** Runtime guard for optimistic flow facts that cross opaque effects. */
export const VELAR_NARROWING_RUNTIME = String.raw`
const __velarNarrowingNativeTypeError = globalThis.TypeError;
class __VelarNarrowingError extends __velarNarrowingNativeTypeError {
  constructor(message) {
    super(message);
    this.name = "NarrowingError";
  }
}
function __velarNarrow(value, valid, expected, description, offset) {
  if (!valid) throw new __VelarNarrowingError("Flow narrowing for '" + description + "' no longer holds: expected " + expected + " at source offset " + offset);
  return value;
}
`.trimStart();

export const VELAR_NARROWING_MODULE_SOURCE = String.raw`
${VELAR_NARROWING_RUNTIME}
export {
  __VelarNarrowingError as NarrowingError,
  __velarNarrow as narrow,
};
`.trimStart();
