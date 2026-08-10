/**
 * Platform-neutral UTF-8 sizing for transport contracts. This intentionally
 * does not depend on TextEncoder or Buffer so every official target applies
 * the same treatment to surrogate pairs and unpaired surrogates.
 */
export const VELAR_UTF8_RUNTIME = String.raw`
const __velarUtf8CharCodeAt = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt")?.value;
const __velarUtf8ReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
function __velarUtf8ByteLength(value) {
  if (typeof value !== "string") throw new TypeError("UTF-8 byte length requires text");
  if (typeof __velarUtf8CharCodeAt !== "function" || typeof __velarUtf8ReflectApply !== "function") {
    throw new TypeError("The host UTF-8 sizing intrinsics are unavailable");
  }
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = __velarUtf8ReflectApply(__velarUtf8CharCodeAt, value, [index]);
    if (unit <= 0x7F) bytes += 1;
    else if (unit <= 0x7FF) bytes += 2;
    else if (unit >= 0xD800 && unit <= 0xDBFF && index + 1 < value.length) {
      const next = __velarUtf8ReflectApply(__velarUtf8CharCodeAt, value, [index + 1]);
      if (next >= 0xDC00 && next <= 0xDFFF) { bytes += 4; index += 1; }
      else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
function __velarDeclaredLength(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (typeof __velarUtf8CharCodeAt !== "function" || typeof __velarUtf8ReflectApply !== "function") {
    throw new TypeError("The host transport sizing intrinsics are unavailable");
  }
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = __velarUtf8ReflectApply(__velarUtf8CharCodeAt, value, [index]);
    if (unit < 48 || unit > 57) return null;
    if (length > 900719925474099) return 1 / 0;
    length = length * 10 + unit - 48;
    if (length > 9007199254740991) return 1 / 0;
  }
  return length;
}
`.trimStart();
