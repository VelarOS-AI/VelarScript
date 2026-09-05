const __velarClassNativeObject = globalThis.Object;
const __velarClassNativeReflect = globalThis.Reflect;
const __velarClassNativeTypeError = globalThis.TypeError;
const __velarClassGetOwnPropertyDescriptor = __velarClassNativeObject.getOwnPropertyDescriptor;
const __velarClassReflectApply = __velarClassGetOwnPropertyDescriptor(__velarClassNativeReflect, "apply")?.value;
const __velarClassReflectGet = __velarClassGetOwnPropertyDescriptor(__velarClassNativeReflect, "get")?.value;
const __velarClassGetPrototypeOf = __velarClassGetOwnPropertyDescriptor(__velarClassNativeObject, "getPrototypeOf")?.value;
function __velarClassHostCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarClassReflectApply !== "function") throw new __velarClassNativeTypeError("The JavaScript class field runtime is unavailable");
  return __velarClassReflectApply(operation, receiver, arguments_);
}
function __velarReadInstanceField(receiver, name) {
  const value = __velarClassHostCall(__velarClassReflectGet, __velarClassNativeReflect, [receiver, name]);
  if (value === undefined) throw new __velarClassNativeTypeError("Field '" + name + "' was read before initialization or contains undefined");
  return value;
}
function __velarReadPrivateField(value, name) {
  if (value === undefined) throw new __velarClassNativeTypeError("Private field '" + name + "' was read before initialization or contains undefined");
  return value;
}
function __velarReadStaticField(receiver, name, ownerDepth) {
  let owner = receiver;
  for (let depth = 0; depth < ownerDepth; depth += 1) owner = __velarClassHostCall(__velarClassGetPrototypeOf, __velarClassNativeObject, [owner]);
  const descriptor = owner == null ? null : __velarClassHostCall(__velarClassGetOwnPropertyDescriptor, __velarClassNativeObject, [owner, name]);
  if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) {
    throw new __velarClassNativeTypeError("Static field '" + name + "' was read before initialization");
  }
  const value = __velarClassHostCall(__velarClassReflectGet, __velarClassNativeReflect, [receiver, name]);
  if (value === undefined) throw new __velarClassNativeTypeError("Static field '" + name + "' contains undefined");
  return value;
}
