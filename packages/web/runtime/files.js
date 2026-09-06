const defaultFileReadBytes = 16 * 1024 * 1024;
const maxFileReadBytes = 64 * 1024 * 1024;
const nativeFileListLength = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "length")?.get : null;
const nativeFileListItem = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "item")?.value : null;
function readLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileReadBytes) throw new RangeError("File maxBytes must be an integer from 1 through 67108864");
  return value;
}
function fileText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function nativePickerField(operation, files, index = null) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native FileList API");
  try { return index === null ? operation.call(files) : operation.call(files, index); }
  catch { throw new TypeError("A file picker returned an invalid native FileList"); }
}
function wrap(file) {
  const name = fileText(__velarReadNativeFileField(__velarNativeFileName, file), "Selected file name", 4096);
  const type = fileText(__velarReadNativeFileField(__velarNativeBlobType, file), "Selected file MIME type", 1024);
  const size = __velarReadNativeFileField(__velarNativeBlobSize, file);
  const modified = __velarReadNativeFileField(__velarNativeFileModified, file);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Selected file size must be a non-negative safe integer");
  if (!Number.isFinite(modified) || modified < 0) throw new TypeError("Selected file modified time must be a non-negative finite number");
  const value = { name, size, type, modified };
  Object.freeze(value);
  WeakMap.prototype.set.call(nativeFiles, value, file);
  return value;
}
function native(file) { return __velarNativeFile(file, "Expected a file returned by velar/files"); }
export function pick(options = {}) {
  options = __velarOptions(options, "File picker options", __velarOptionFields(["accept", "multiple"]));
  const accept = options.accept == null ? "" : __velarString(options.accept, "File accept filter");
  if (accept.length > 4096) throw new RangeError("File accept filters cannot exceed 4096 characters");
  const multiple = options.multiple == null ? false : __velarBool(options.multiple, "File picker multiple");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      globalThis.removeEventListener("focus", focused);
      try {
        const selected = input.files;
        if (!selected || typeof selected !== "object") throw new TypeError("A file picker returned an invalid file list");
        const count = nativePickerField(nativeFileListLength, selected);
        if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("A file picker returned an invalid file list length");
        if (count > 10000) {
          input.remove();
          reject(new RangeError("A file picker cannot return more than 10000 files"));
          return;
        }
        const files = [];
        for (let index = 0; index < count; index += 1) {
          const file = nativePickerField(nativeFileListItem, selected, index);
          if (file === null) throw new TypeError("A file picker returned an incomplete native FileList");
          files.push(wrap(file));
        }
        input.remove();
        resolve(files);
      } catch (error) {
        input.remove();
        reject(error);
      }
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    const focused = () => setTimeout(finish, 0);
    globalThis.addEventListener("focus", focused, { once: true });
    input.click();
  });
}
export function readText(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  if (typeof __velarNativeBlobText !== "function") throw new TypeError("The browser does not expose native Blob text reading");
  return Promise.resolve(__velarNativeBlobText.call(value)).then((result) => {
    if (typeof result !== "string") throw new TypeError("File text result was not a string");
    if (result.length > maxBytes) throw new RangeError("File text result exceeds maxBytes");
    return result;
  });
}
export function readDataUrl(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { reject(new TypeError("File data URL result was not text")); return; }
      if (reader.result.length > Math.ceil(maxBytes * 4 / 3) + 4096) { reject(new RangeError("File data URL result exceeds maxBytes expansion")); return; }
      resolve(reader.result);
    };
    reader.onerror = () => reject(__velarIsError(reader.error) ? reader.error : new __velarErrorNativeError("File reading failed"));
    reader.readAsDataURL(value);
  });
}
export function download(name, data, mime = "text/plain;charset=utf-8") {
  name = __velarString(name, "Download name");
  data = __velarString(data, "Download data");
  mime = __velarString(mime, "Download MIME type");
  if (!name || name.length > 4096) throw new RangeError("Download names must contain 1 through 4096 characters");
  if (data.length > maxFileReadBytes) throw new RangeError("Download text cannot exceed 64 MiB");
  if (!mime || mime.length > 1024) throw new RangeError("Download MIME types must contain 1 through 1024 characters");
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}
