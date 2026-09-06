// D7: 'isUuid' answers the textual question its name and documentation ask —
// 36 characters, hyphenated 8-4-4-4-12, hexadecimal in either case. Constraining
// the version and variant nibbles rejected canonical text a caller cannot fix:
// the nil and max UUIDs of RFC 9562 and every GUID from a variant other than
// RFC 4122, which is what a .NET 'Guid.Empty' or an older partner system sends.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const __velarIdNativeTypeError = globalThis.TypeError;
const __velarIdGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarIdGetPrototypeOf = Object.getPrototypeOf;
const __velarIdRegExpPrototype = __velarIdGetPrototypeOf(uuidPattern);
const __velarIdRegExpTest = __velarIdGetOwnPropertyDescriptor(__velarIdRegExpPrototype, "test")?.value;
const __velarIdCrypto = globalThis.crypto;
let __velarIdRandomUuid = null;
let __velarIdCapabilityFailure = null;

if (!__velarIdCrypto || typeof __velarIdCrypto !== "object") {
  __velarIdCapabilityFailure = new __velarErrorNativeError("Secure UUID generation is unavailable in this JavaScript host");
} else {
  let owner = __velarIdCrypto;
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarIdGetOwnPropertyDescriptor(owner, "randomUUID");
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        __velarIdCapabilityFailure = new __velarIdNativeTypeError("crypto.randomUUID must be a data function");
      } else __velarIdRandomUuid = descriptor.value;
      break;
    }
    owner = __velarIdGetPrototypeOf(owner);
  }
  if (!__velarIdRandomUuid && !__velarIdCapabilityFailure) {
    __velarIdCapabilityFailure = new __velarErrorNativeError("Secure UUID generation is unavailable in this JavaScript host");
  }
}

export function uuid() {
  if (__velarIdCapabilityFailure) throw __velarIdCapabilityFailure;
  let value;
  try { value = __velarErrorApply(__velarIdRandomUuid, __velarIdCrypto, [], "crypto.randomUUID"); }
  catch (failure) { if (__velarIsError(failure)) throw failure; throw new __velarErrorNativeError("Secure UUID generation failed", { cause: failure }); }
  if (!isUuid(value)) throw new __velarErrorNativeError("Secure UUID generation returned an invalid UUID");
  return value;
}

export function isUuid(value) {
  return typeof value === "string" && value.length === 36
    && __velarErrorApply(__velarIdRegExpTest, uuidPattern, [value], "RegExp.test");
}
