/**
 * Node 环境中唯一的文本哈希边界。
 *
 * VelarScript 对外只提供一个有输入上限、结果确定的 sha256Text 操作，不把
 * Node.js 中可变且带内部状态的 Hash 对象交给应用代码。模块初始化时会固定后续
 * 需要使用的 JavaScript 与 Node.js 原生操作，避免应用替换全局对象或原型方法后
 * 改变哈希行为。
 */
export const VELAR_NODE_HASH_RUNTIME = String.raw`
import { createHash as __velarHashCreateHash } from "node:crypto";

const __velarHashNativeError = globalThis.Error;
const __velarHashNativeObject = globalThis.Object;
const __velarHashNativeRangeError = globalThis.RangeError;
const __velarHashNativeReflect = globalThis.Reflect;
const __velarHashNativeString = globalThis.String;
const __velarHashNativeTypeError = globalThis.TypeError;
const __velarHashOwnDescriptor = __velarHashNativeObject.getOwnPropertyDescriptor;
const __velarHashGetPrototypeOf = __velarHashNativeObject.getPrototypeOf;
const __velarHashApply = __velarHashOwnDescriptor(__velarHashNativeReflect, "apply")?.value;
const __velarHashMaxTextBytes = 16 * 1024 * 1024;

function __velarHashDataOperation(target, name) {
  const descriptor = __velarHashOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarHashNativeError("VelarScript hashing host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}

if (typeof __velarHashApply !== "function" || typeof __velarHashCreateHash !== "function") {
  throw new __velarHashNativeError("VelarScript SHA-256 host capability is unavailable");
}

// createHash 返回的具体类型没有作为公共类型暴露。这里创建一个只在初始化阶段
// 使用的探针实例，通过它取得原生 Hash 原型并固定 update、digest 方法；固定完成
// 后立即结束这个探针。应用最终只能调用 sha256Text，接触不到这个可变对象。
const __velarHashProbe = __velarHashApply(__velarHashCreateHash, undefined, ["sha256"]);
const __velarHashPrototype = __velarHashApply(__velarHashGetPrototypeOf, __velarHashNativeObject, [__velarHashProbe]);
const __velarHashUpdate = __velarHashDataOperation(__velarHashPrototype, "update");
const __velarHashDigest = __velarHashDataOperation(__velarHashPrototype, "digest");
const __velarHashCharCodeAt = __velarHashDataOperation(__velarHashNativeString.prototype, "charCodeAt");
__velarHashApply(__velarHashDigest, __velarHashProbe, ["hex"]);

function __velarHashResult(value) {
  if (typeof value !== "string" || value.length !== 64) {
    throw new __velarHashNativeTypeError("SHA-256 host returned an invalid digest");
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = __velarHashApply(__velarHashCharCodeAt, value, [index]);
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
      throw new __velarHashNativeTypeError("SHA-256 host returned an invalid digest");
    }
  }
  return value;
}

export function sha256Text(text) {
  if (typeof text !== "string") throw new __velarHashNativeTypeError("sha256Text requires text");
  if (__velarUtf8ByteLength(text) > __velarHashMaxTextBytes) {
    throw new __velarHashNativeRangeError("sha256Text input cannot exceed 16 MiB of UTF-8 text");
  }
  const hash = __velarHashApply(__velarHashCreateHash, undefined, ["sha256"]);
  const updated = __velarHashApply(__velarHashUpdate, hash, [text, "utf8"]);
  if (updated !== hash) throw new __velarHashNativeTypeError("SHA-256 host returned an invalid update result");
  return __velarHashResult(__velarHashApply(__velarHashDigest, hash, ["hex"]));
}
`.trimStart();
