function __velarFileTypeIs(value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.file.registry.v1"));
  if (!descriptor || !("value" in descriptor) || descriptor.configurable || descriptor.enumerable || descriptor.writable) return false;
  try { return WeakMap.prototype.has.call(descriptor.value, value); }
  catch { return false; }
}
