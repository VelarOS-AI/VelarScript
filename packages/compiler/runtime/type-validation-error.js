const __velarValidationErrorDefineProperty = globalThis.Object.defineProperty;
class __VelarValidationError extends __velarCollectionNativeTypeError {
  constructor(message, detail) {
    super(message);
    this.name = "ValidationError";
    this.path = detail?.path ?? null;
    this.field = detail?.field ?? null;
    this.reason = detail?.reason ?? null;
  }
}
// D51 rule 107: 'code' answers with the class a value was constructed from, so
// the compiler-owned class carries the source-level name it reports.
__velarValidationErrorDefineProperty(__VelarValidationError, "name", { value: "ValidationError", writable: false, enumerable: false, configurable: true });
