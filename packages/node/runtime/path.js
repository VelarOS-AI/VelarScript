import { basename as nodeBasename, dirname as nodeDirname, extname, isAbsolute as nodeIsAbsolute, join as nodeJoin, normalize as nodeNormalize, relative as nodeRelative, resolve as nodeResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIncludes = String.prototype.includes;
const pathStringStartsWith = String.prototype.startsWith;
const pathSeparator = process.platform === "win32" ? "\\" : "/";
function stringIncludes(value, search) { return pathApply(pathStringIncludes, value, [search]); }
function stringStartsWith(value, search) { return pathApply(pathStringStartsWith, value, [search]); }
function pathValue(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || stringIncludes(value, "\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function pathParts(values, operation) {
  if (!pathArrayIsArray(values) || values.length > 256) throw new TypeError(operation + " requires a bounded List<string>");
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = pathGetOwnPropertyDescriptor(values, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(operation + " path parts must contain enumerable data values");
    output[output.length] = pathValue(descriptor.value, operation);
  }
  return output;
}
function bounded(value, operation) {
  if (value.length > maxPathCodeUnits) throw new RangeError(operation + " result is outside the supported bounds");
  return value;
}

export function resolve(parts = []) { return bounded(pathApply(nodeResolve, undefined, pathParts(parts, "resolve")), "resolve"); }
export function join(parts = []) { return bounded(pathApply(nodeJoin, undefined, pathParts(parts, "join")), "join"); }
export function normalize(path) { return bounded(nodeNormalize(pathValue(path, "normalize")), "normalize"); }
export function relative(from, to) { return bounded(nodeRelative(pathValue(from, "relative"), pathValue(to, "relative")), "relative"); }
export function dirname(path) { return bounded(nodeDirname(pathValue(path, "dirname")), "dirname"); }
export function basename(path) { return nodeBasename(pathValue(path, "basename")); }
export function extension(path) { return extname(pathValue(path, "extension")); }
export function isAbsolute(path) { return nodeIsAbsolute(pathValue(path, "isAbsolute")); }
export function contains(root, target) {
  root = nodeResolve(pathValue(root, "contains"));
  target = nodeResolve(pathValue(target, "contains"));
  const path = nodeRelative(root, target);
  return path === "" || (path !== ".." && !stringStartsWith(path, ".." + pathSeparator) && !nodeIsAbsolute(path));
}
export function toFileUrl(path) { return pathToFileURL(nodeResolve(pathValue(path, "toFileUrl"))).href; }
export function fromFileUrl(url) {
  url = pathValue(url, "fromFileUrl");
  if (!stringStartsWith(url, "file:")) throw new TypeError("fromFileUrl requires a file URL");
  return bounded(fileURLToPath(url), "fromFileUrl");
}
