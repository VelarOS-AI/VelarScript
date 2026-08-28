/**
 * Target-neutral, synchronous SHA-256 for the Core `velar/hash` contract.
 *
 * The implementation deliberately uses only the Core binary module and
 * captured JavaScript string/reflection intrinsics. Node, Web, and Desktop
 * therefore hash the same UTF-8 bytes without a target capability or mutable
 * host Hash handle.
 */
export const VELAR_CORE_HASH_RUNTIME = String.raw`
import {uint8Buffer, uint32Buffer} from "velar/binary";

const __velarHashNativeReflect = globalThis.Reflect;
const __velarHashNativeString = globalThis.String;
const __velarHashNativeTypeError = globalThis.TypeError;
const __velarHashNativeRangeError = globalThis.RangeError;
const __velarHashOwnDescriptor = globalThis.Object.getOwnPropertyDescriptor;
const __velarHashApply = __velarHashOwnDescriptor(__velarHashNativeReflect, "apply")?.value;
const __velarHashCharCodeAt = __velarHashOwnDescriptor(__velarHashNativeString.prototype, "charCodeAt")?.value;
const __velarHashMaxTextBytes = 16 * 1024 * 1024;
const __velarHashHexadecimal = "0123456789abcdef";
const __velarHashRoundConstants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

if (typeof __velarHashApply !== "function" || typeof __velarHashCharCodeAt !== "function") {
  throw new __velarHashNativeTypeError("The JavaScript text hashing intrinsics are unavailable");
}

function __velarHashCodeUnit(text, index) {
  return __velarHashApply(__velarHashCharCodeAt, text, [index]);
}

function __velarHashUtf8Size(text) {
  let size = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = __velarHashCodeUnit(text, index);
    if (unit <= 0x7f) size += 1;
    else if (unit <= 0x7ff) size += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = __velarHashCodeUnit(text, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        index += 1;
      } else size += 3;
    } else size += 3;
    if (size > __velarHashMaxTextBytes) {
      throw new __velarHashNativeRangeError("sha256Text input cannot exceed 16 MiB of UTF-8 text");
    }
  }
  return size;
}

function __velarHashPaddedUtf8(text) {
  const byteSize = __velarHashUtf8Size(text);
  let paddedSize = byteSize + 9;
  paddedSize += (64 - paddedSize % 64) % 64;
  const bytes = uint8Buffer(paddedSize);
  let offset = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = __velarHashCodeUnit(text, index);
    let point = unit;
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = __velarHashCodeUnit(text, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        point = 0x10000 + ((unit - 0xd800) << 10) + next - 0xdc00;
        index += 1;
      } else point = 0xfffd;
    } else if (unit >= 0xd800 && unit <= 0xdfff) point = 0xfffd;

    if (point <= 0x7f) {
      bytes[offset] = point;
      offset += 1;
    } else if (point <= 0x7ff) {
      bytes[offset] = 0xc0 | point >>> 6;
      bytes[offset + 1] = 0x80 | point & 0x3f;
      offset += 2;
    } else if (point <= 0xffff) {
      bytes[offset] = 0xe0 | point >>> 12;
      bytes[offset + 1] = 0x80 | point >>> 6 & 0x3f;
      bytes[offset + 2] = 0x80 | point & 0x3f;
      offset += 3;
    } else {
      bytes[offset] = 0xf0 | point >>> 18;
      bytes[offset + 1] = 0x80 | point >>> 12 & 0x3f;
      bytes[offset + 2] = 0x80 | point >>> 6 & 0x3f;
      bytes[offset + 3] = 0x80 | point & 0x3f;
      offset += 4;
    }
  }
  bytes[byteSize] = 0x80;
  const bitSize = byteSize * 8;
  bytes[paddedSize - 4] = bitSize >>> 24 & 0xff;
  bytes[paddedSize - 3] = bitSize >>> 16 & 0xff;
  bytes[paddedSize - 2] = bitSize >>> 8 & 0xff;
  bytes[paddedSize - 1] = bitSize & 0xff;
  return bytes;
}

function __velarHashRotateRight(value, count) {
  return (value >>> count | value << 32 - count) >>> 0;
}

function __velarHashHexadecimalWord(word) {
  let result = "";
  for (let index = 0; index < 8; index += 1) {
    result += __velarHashHexadecimal[word >>> 28 - index * 4 & 0x0f];
  }
  return result;
}

export function sha256Text(text) {
  if (typeof text !== "string") throw new __velarHashNativeTypeError("sha256Text requires text");
  const bytes = __velarHashPaddedUtf8(text);
  const words = uint32Buffer(64);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let chunkOffset = 0; chunkOffset < bytes.length; chunkOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = chunkOffset + index * 4;
      words[index] = (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = words[index - 15];
      const earlier = words[index - 2];
      const sigma0 = (__velarHashRotateRight(previous, 7) ^ __velarHashRotateRight(previous, 18) ^ previous >>> 3) >>> 0;
      const sigma1 = (__velarHashRotateRight(earlier, 17) ^ __velarHashRotateRight(earlier, 19) ^ earlier >>> 10) >>> 0;
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = (__velarHashRotateRight(e, 6) ^ __velarHashRotateRight(e, 11) ^ __velarHashRotateRight(e, 25)) >>> 0;
      const choice = (e & f ^ ~e & g) >>> 0;
      const temporary1 = (h + sum1 + choice + __velarHashRoundConstants[index] + words[index]) >>> 0;
      const sum0 = (__velarHashRotateRight(a, 2) ^ __velarHashRotateRight(a, 13) ^ __velarHashRotateRight(a, 22)) >>> 0;
      const majority = (a & b ^ a & c ^ b & c) >>> 0;
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return __velarHashHexadecimalWord(h0) + __velarHashHexadecimalWord(h1)
    + __velarHashHexadecimalWord(h2) + __velarHashHexadecimalWord(h3)
    + __velarHashHexadecimalWord(h4) + __velarHashHexadecimalWord(h5)
    + __velarHashHexadecimalWord(h6) + __velarHashHexadecimalWord(h7);
}
`.trimStart();
