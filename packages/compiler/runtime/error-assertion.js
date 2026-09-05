const __velarAssertionNativeError = globalThis.Error;
const __velarAssertionDefineProperty = globalThis.Object.defineProperty;
class __VelarAssertionError extends __velarAssertionNativeError {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}
__velarAssertionDefineProperty(__VelarAssertionError, "name", { value: "AssertionError", writable: false, enumerable: false, configurable: true });
