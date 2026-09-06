const __velarIndexErrorNativeRangeError = globalThis.RangeError;
const __velarIndexErrorDefineProperty = globalThis.Object.defineProperty;
class __VelarIndexError extends __velarIndexErrorNativeRangeError {
  constructor(message) {
    super(message);
    this.name = "IndexError";
  }
}
// D51 rule 107: 'code' answers with the class a value was constructed from, so
// the compiler-owned class carries the source-level name it reports.
__velarIndexErrorDefineProperty(__VelarIndexError, "name", { value: "IndexError", writable: false, enumerable: false, configurable: true });
