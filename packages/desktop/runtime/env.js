let cachedSnapshot = null;
function variableName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || value.length > 256) {
    throw new TypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}
function snapshot() {
  if (cachedSnapshot) return cachedSnapshot;
  const desktopEnvironment = __velarDesktopHostField("environment");
  if (!desktopEnvironment || typeof desktopEnvironment !== "object" || Array.isArray(desktopEnvironment)) {
    throw new Error("VelarScript Desktop environment snapshot is unavailable");
  }
  const value = desktopEnvironment;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop environment snapshot must be a plain record");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) throw new RangeError("Desktop environment snapshot cannot exceed 64 variables");
  const output = Object.create(null);
  let bytes = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(key)) throw new TypeError("Desktop environment snapshot has an invalid variable name");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop environment snapshot fields must be enumerable data values");
    if (typeof descriptor.value !== "string") throw new TypeError("Desktop environment snapshot values must be text");
    const itemBytes = new TextEncoder().encode(descriptor.value).byteLength;
    bytes += new TextEncoder().encode(key).byteLength + itemBytes;
    if (itemBytes > 64 * 1024 || bytes > 1024 * 1024) throw new RangeError("Desktop environment snapshot exceeds its size boundary");
    output[key] = descriptor.value;
  }
  cachedSnapshot = Object.freeze(output);
  return cachedSnapshot;
}
export function get(name) {
  name = variableName(name);
  const values = snapshot();
  return Object.prototype.hasOwnProperty.call(values, name) ? Object.getOwnPropertyDescriptor(values, name).value : null;
}
export function require(name) {
  name = variableName(name);
  const value = get(name);
  if (value === null) throw new Error("VelarScript environment variable '" + name + "' is required");
  return value;
}
