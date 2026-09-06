const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathArrayJoin = Array.prototype.join;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIndexOf = String.prototype.indexOf;
const pathStringSlice = String.prototype.slice;
const pathStringToLowerCase = String.prototype.toLowerCase;
const pathEncodeURIComponent = encodeURIComponent;
const pathDecodeURIComponent = decodeURIComponent;
const pathNativeURL = URL;
const pathURLProtocol = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "protocol")?.get;
const pathURLUsername = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "username")?.get;
const pathURLPassword = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "password")?.get;
const pathURLPort = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "port")?.get;
const pathURLSearch = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "search")?.get;
const pathURLHash = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hash")?.get;
const pathURLHostname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hostname")?.get;
const pathURLPathname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "pathname")?.get;
if (typeof pathURLProtocol !== "function" || typeof pathURLUsername !== "function" || typeof pathURLPassword !== "function"
  || typeof pathURLPort !== "function" || typeof pathURLSearch !== "function" || typeof pathURLHash !== "function"
  || typeof pathURLHostname !== "function" || typeof pathURLPathname !== "function") {
  throw new TypeError("Desktop path URL runtime is unavailable");
}
function stringIndexOf(value, search) { return pathApply(pathStringIndexOf, value, [search]); }
function stringSlice(value, start, end) { return pathApply(pathStringSlice, value, end === undefined ? [start] : [start, end]); }
function stringToLowerCase(value) { return pathApply(pathStringToLowerCase, value, []); }
function arrayJoin(value, separator) { return pathApply(pathArrayJoin, value, [separator]); }
function urlValue(value, getter) { return pathApply(getter, value, []); }
function checked(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || stringIndexOf(value, "\0") !== -1) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function bounded(value, operation) {
  if (value.length > maxPathCodeUnits) throw new RangeError(operation + " result is outside the supported bounds");
  return value;
}
function normalizePath(value) {
  const absolute = value[0] === "/";
  const trailing = value[value.length - 1] === "/";
  const output = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    const part = stringSlice(value, start, index);
    start = index + 1;
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      output[output.length] = part;
      continue;
    }
    if (output.length > 0 && output[output.length - 1] !== "..") output.length -= 1;
    else if (!absolute) output[output.length] = "..";
  }
  const body = arrayJoin(output, "/");
  let result = absolute ? "/" + body : body;
  if (result === "") result = absolute ? "/" : ".";
  if (trailing && result !== "/") result += "/";
  return result;
}
function dirnamePath(value) {
  const absolute = value[0] === "/";
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 1; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        end = index;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return absolute ? "/" : ".";
  if (absolute && end === 1) return "//";
  return stringSlice(value, 0, end);
}
function basenamePath(value) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        start = index + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
  }
  return end === -1 ? "" : stringSlice(value, start, end);
}
function extensionPath(value) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];
    if (character === "/") {
      if (!matchedSlash) {
        startPart = index + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
    if (character === ".") {
      if (startDot === -1) startDot = index;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0
    || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return stringSlice(value, startDot, end);
}
function parts(value, operation) {
  if (!pathArrayIsArray(value) || value.length > 256) throw new TypeError(operation + " requires a bounded List<string>");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = pathGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(operation + " path parts must contain enumerable data values");
    output[output.length] = checked(descriptor.value, operation);
  }
  return output;
}
function projectDirectory() {
  const provider = __velarDesktopHostField("projectDirectoryValue");
  if (typeof provider !== "function") throw new TypeError("Desktop project directory provider must be a function data value");
  const value = checked(pathApply(provider, undefined, []), "resolve");
  if (!value.startsWith("/")) throw new TypeError("Desktop project directory must be absolute");
  return value;
}
function resolved(values, operation) {
  let value = projectDirectory();
  const normalizedParts = parts(values, operation);
  for (let index = 0; index < normalizedParts.length; index += 1) {
    const item = normalizedParts[index];
    value = item[0] === "/" ? item : value + "/" + item;
  }
  return normalizePath(value);
}
function pathSegments(value) {
  const output = [];
  let start = value[0] === "/" ? 1 : 0;
  for (let index = start; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    if (index > start) output[output.length] = stringSlice(value, start, index);
    start = index + 1;
  }
  return output;
}
function relativeValue(from, to) {
  const left = pathSegments(resolved([checked(from, "relative")], "relative"));
  const right = pathSegments(resolved([checked(to, "relative")], "relative"));
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
  const output = [];
  for (let index = shared; index < left.length; index += 1) output[output.length] = "..";
  for (let index = shared; index < right.length; index += 1) output[output.length] = right[index];
  return arrayJoin(output, "/");
}
export function normalize(path) { return bounded(normalizePath(checked(path, "normalize")), "normalize"); }
export function join(values = []) { return bounded(normalizePath(arrayJoin(parts(values, "join"), "/")), "join"); }
export function resolve(values = []) { return bounded(resolved(values, "resolve"), "resolve"); }
export function relative(from, to) { return bounded(relativeValue(from, to), "relative"); }
export function dirname(path) { return bounded(dirnamePath(checked(path, "dirname")), "dirname"); }
export function basename(path) { return basenamePath(checked(path, "basename")); }
export function extension(path) { return extensionPath(checked(path, "extension")); }
export function isAbsolute(path) { return checked(path, "isAbsolute")[0] === "/"; }
export function contains(root, target) { const value = relativeValue(root, target); return value === "" || (value !== ".." && stringIndexOf(value, "../") !== 0 && value[0] !== "/"); }
export function toFileUrl(path) {
  const segments = pathSegments(resolved([checked(path, "toFileUrl")], "toFileUrl"));
  const encoded = [];
  for (let index = 0; index < segments.length; index += 1) encoded[index] = pathEncodeURIComponent(segments[index]);
  return "file:///" + arrayJoin(encoded, "/");
}
export function fromFileUrl(value) {
  value = checked(value, "fromFileUrl");
  let url;
  try { url = new pathNativeURL(value); } catch { throw new TypeError("fromFileUrl requires a valid file URL"); }
  const pathname = urlValue(url, pathURLPathname);
  const lowercasePathname = stringToLowerCase(pathname);
  const encodedSeparator = stringIndexOf(lowercasePathname, "%2f") !== -1 || stringIndexOf(lowercasePathname, "%5c") !== -1;
  const hostname = urlValue(url, pathURLHostname);
  if (urlValue(url, pathURLProtocol) !== "file:" || urlValue(url, pathURLUsername) !== "" || urlValue(url, pathURLPassword) !== ""
    || urlValue(url, pathURLPort) !== "" || urlValue(url, pathURLSearch) !== "" || urlValue(url, pathURLHash) !== ""
    || hostname !== "" && hostname !== "localhost" || encodedSeparator) throw new TypeError("fromFileUrl requires a local file URL");
  let path;
  try { path = pathDecodeURIComponent(pathname); } catch { throw new TypeError("fromFileUrl requires a valid encoded file URL"); }
  return bounded(normalizePath(path), "fromFileUrl");
}
