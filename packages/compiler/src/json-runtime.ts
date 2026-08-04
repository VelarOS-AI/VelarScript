export const VELAR_STRICT_JSON_RUNTIME = String.raw`
const __velarMaxJsonCodeUnits = 16 * 1024 * 1024;
const __velarMaxJsonNodes = 1000000;
const __velarMaxJsonDepth = 128;
function __velarJsonFailure(path, message) {
  throw new TypeError("Invalid JSON value at " + path + ": " + message);
}
function __velarJsonPath(parent, key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ? parent + "." + key : parent + "[field]";
}
function __velarJsonStringUnits(value) {
  let units = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) units += 2;
    else if (code <= 31 || (code >= 0xD800 && code <= 0xDFFF && !(code <= 0xDBFF && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF))) units += 6;
    else { units += 1; if (code >= 0xD800 && code <= 0xDBFF) { units += 1; index += 1; } }
    if (units > __velarMaxJsonCodeUnits) return units;
  }
  return units;
}
function __velarJsonBudget(state, path) {
  if (state.nodes > __velarMaxJsonNodes) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonNodes + " values");
  if (state.compactUnits > __velarMaxJsonCodeUnits) __velarJsonFailure(path, "encoded JSON cannot exceed 16 MiB");
}
function __velarJsonState() { return { active: new Set(), nodes: 0, depth: 0, compactUnits: 0, prettyLines: 0, prettyIndentWeight: 0, prettyColonSpaces: 0 }; }
function __velarInspectJson(value, path, state, copy) {
  state.nodes += 1;
  if (value === null) { state.compactUnits += 4; __velarJsonBudget(state, path); return value; }
  if (typeof value === "string") { state.compactUnits += __velarJsonStringUnits(value); __velarJsonBudget(state, path); return value; }
  if (typeof value === "boolean") { state.compactUnits += value ? 4 : 5; __velarJsonBudget(state, path); return value; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) __velarJsonFailure(path, "numbers must be finite");
    state.compactUnits += String(value).length;
    __velarJsonBudget(state, path);
    return value;
  }
  if (typeof value !== "object") __velarJsonFailure(path, typeof value + " is not supported");
  if (state.depth >= __velarMaxJsonDepth) __velarJsonFailure(path, "data cannot exceed " + __velarMaxJsonDepth + " nested collections");
  if (state.active.has(value)) __velarJsonFailure(path, "cyclic data is not supported");
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 1000000) __velarJsonFailure(path, "Lists cannot exceed 1000000 items");
      if (Object.getOwnPropertySymbols(value).length > 0) __velarJsonFailure(path, "List symbol fields are not supported");
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || names[names.length - 1] !== "length") {
        __velarJsonFailure(path, "Lists must be dense and cannot have extra fields");
      }
      state.compactUnits += 2 + Math.max(0, value.length - 1);
      if (value.length > 0) {
        state.prettyLines += value.length + 1;
        state.prettyIndentWeight += value.length * (state.depth + 1) + state.depth;
      }
      __velarJsonBudget(state, path);
      const output = copy ? new Array(value.length) : value;
      state.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor?.enumerable || !("value" in descriptor)) __velarJsonFailure(path + "[" + index + "]", "List entries must be enumerable data values");
        const child = __velarInspectJson(descriptor.value, path + "[" + index + "]", state, copy);
        if (copy) output[index] = child;
      }
      state.depth -= 1;
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      __velarJsonFailure(path, "only records and Lists are supported");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > 1000000) __velarJsonFailure(path, "records cannot exceed 1000000 fields");
    state.compactUnits += 2 + Math.max(0, keys.length - 1);
    if (keys.length > 0) {
      state.prettyLines += keys.length + 1;
      state.prettyIndentWeight += keys.length * (state.depth + 1) + state.depth;
      state.prettyColonSpaces += keys.length;
    }
    __velarJsonBudget(state, path);
    const output = copy ? Object.create(null) : value;
    state.depth += 1;
    for (const key of keys) {
      if (typeof key !== "string") __velarJsonFailure(path, "record symbol fields are not supported");
      state.compactUnits += __velarJsonStringUnits(key) + 1;
      __velarJsonBudget(state, path);
      const childPath = __velarJsonPath(path, key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        __velarJsonFailure(childPath, "record fields must be enumerable data values");
      }
      const child = __velarInspectJson(descriptor.value, childPath, state, copy);
      if (copy) Object.defineProperty(output, key, { value: child, enumerable: true, configurable: true, writable: true });
    }
    state.depth -= 1;
    return output;
  } finally {
    state.active.delete(value);
  }
}
function __velarAssertJson(value, path = "$", state = null) {
  state ??= __velarJsonState();
  __velarInspectJson(value, path, state, false);
  return state;
}
function __velarJsonSnapshot(value) {
  const state = __velarJsonState();
  return { value: __velarInspectJson(value, "$", state, true), state };
}
function __velarJsonIndent(pretty) {
  if (pretty === false) return 0;
  if (pretty === true) return 2;
  if (!Number.isInteger(pretty) || pretty < 0 || pretty > 10) {
    throw new RangeError("JSON indentation must be false, true, or an integer from 0 to 10");
  }
  return pretty;
}
function __velarJsonStringify(value, pretty = false) {
  const snapshot = __velarJsonSnapshot(value);
  const state = snapshot.state;
  const indentation = __velarJsonIndent(pretty);
  const estimated = state.compactUnits + (indentation ? state.prettyLines + state.prettyColonSpaces + state.prettyIndentWeight * indentation : 0);
  if (estimated > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  const output = JSON.stringify(snapshot.value, null, indentation);
  if (typeof output !== "string") throw new TypeError("The host JSON serializer must return a string");
  if (output.length > __velarMaxJsonCodeUnits) throw new RangeError("Encoded JSON cannot exceed 16 MiB");
  return output;
}
`.trimStart();
