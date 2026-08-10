// Canonical Node environment boundary. The process.env object and every
// JavaScript operation used to validate/read it are captured while the
// official module initializes, so later application-Realm replacement cannot
// redirect environment reads or execute accessors.
export const VELAR_NODE_ENV_RUNTIME = String.raw`
const __velarEnvNativeError = globalThis.Error;
const __velarEnvNativeObject = globalThis.Object;
const __velarEnvNativeReflect = globalThis.Reflect;
const __velarEnvNativeRegExp = globalThis.RegExp;
const __velarEnvNativeTypeError = globalThis.TypeError;
const __velarEnvOwnDescriptor = __velarEnvNativeObject.getOwnPropertyDescriptor;
const __velarEnvApply = __velarEnvNativeReflect.apply;
function __velarEnvDataOperation(target, name) {
  const descriptor = __velarEnvOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarEnvNativeError("VelarScript environment host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarEnvRegExpTest = __velarEnvDataOperation(__velarEnvNativeRegExp.prototype, "test");
const __velarEnvEnvironment = globalThis.process.env;
const __velarEnvNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function __velarEnvName(value) {
  if (typeof value !== "string"
    || value.length > 256
    || !__velarEnvApply(__velarEnvRegExpTest, __velarEnvNamePattern, [value])) {
    throw new __velarEnvNativeTypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}

function __velarEnvValue(name) {
  const descriptor = __velarEnvOwnDescriptor(__velarEnvEnvironment, name);
  if (!descriptor) return null;
  if (!("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new __velarEnvNativeTypeError("Environment variable values must be host-owned text");
  }
  return descriptor.value;
}

export function get(name) {
  return __velarEnvValue(__velarEnvName(name));
}

export function require(name) {
  name = __velarEnvName(name);
  const value = __velarEnvValue(name);
  if (value === null) throw new __velarEnvNativeError("VelarScript environment variable '" + name + "' is required");
  return value;
}
`.trimStart();
