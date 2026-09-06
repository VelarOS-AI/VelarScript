const __velarHostErrorNativeError = globalThis.Error;
const __velarHostErrorDefineProperty = globalThis.Object.defineProperty;
class __VelarFileNotFoundError extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = "FileNotFoundError";
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__VelarFileNotFoundError, "name", { value: "FileNotFoundError", writable: false, enumerable: false, configurable: true });
class __VelarPermissionError extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = "PermissionError";
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__VelarPermissionError, "name", { value: "PermissionError", writable: false, enumerable: false, configurable: true });
class __VelarNotADirectoryError extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = "NotADirectoryError";
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__VelarNotADirectoryError, "name", { value: "NotADirectoryError", writable: false, enumerable: false, configurable: true });
class __VelarFileExistsError extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = "FileExistsError";
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__VelarFileExistsError, "name", { value: "FileExistsError", writable: false, enumerable: false, configurable: true });
class __VelarAddressInUseError extends __velarHostErrorNativeError {
  constructor(message) {
    super(message);
    this.name = "AddressInUseError";
  }
}
__velarHostErrorDefineProperty(__VelarAddressInUseError, "name", { value: "AddressInUseError", writable: false, enumerable: false, configurable: true });
class __VelarTimeoutError extends __velarHostErrorNativeError {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}
__velarHostErrorDefineProperty(__VelarTimeoutError, "name", { value: "TimeoutError", writable: false, enumerable: false, configurable: true });
