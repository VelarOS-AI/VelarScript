const source = "__VELAR_PUBLIC_CONFIG__";
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
const value = freeze(source);
export function publicConfig(Type) { Type = __velarRequireRuntimeType(Type, "publicConfig"); return Type.parse(value); }
export function has(key) { if (typeof key !== "string") throw new TypeError("Config keys must be strings"); return Object.prototype.hasOwnProperty.call(value, key); }
export function keys() { return Object.keys(value).sort(); }
