const nativeFilesKey = Symbol.for("velar.file.registry.v1");
const nativeFiles = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, nativeFilesKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("VelarScript file registry cannot be an accessor");
    if (descriptor.configurable || descriptor.enumerable || descriptor.writable) throw new TypeError("VelarScript file registry ownership is invalid");
    try { WeakMap.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("VelarScript file registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakMap();
  Object.defineProperty(globalThis, nativeFilesKey, { value: registry, enumerable: false, configurable: false, writable: false });
  return registry;
})();
const __velarNativeFileName = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "name")?.get : null;
const __velarNativeFileModified = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "lastModified")?.get : null;
const __velarNativeBlobSize = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get : null;
const __velarNativeBlobType = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "type")?.get : null;
const __velarNativeBlobText = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "text")?.value : null;
function __velarReadNativeFileField(operation, file) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native File API");
  try { return operation.call(file); }
  catch { throw new TypeError("A file picker returned an invalid native File"); }
}
function __velarNativeFile(value, message) {
  const file = value && WeakMap.prototype.get.call(nativeFiles, value);
  if (!file) throw new TypeError(message);
  try {
    if (typeof __velarNativeFileName !== "function") throw new TypeError();
    __velarNativeFileName.call(file);
  } catch { throw new TypeError(message); }
  return file;
}
