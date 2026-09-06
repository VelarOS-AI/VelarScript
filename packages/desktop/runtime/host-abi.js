const __velarDesktopBridgeKey = Symbol.for("velar.desktop.bridge.v1");
const __velarDesktopGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarDesktopReflectApply = Reflect.apply;
const __velarDesktopBridgeDescriptor = __velarDesktopGetOwnPropertyDescriptor(globalThis, __velarDesktopBridgeKey);
const __velarDesktopBridge = __velarDesktopBridgeDescriptor && "value" in __velarDesktopBridgeDescriptor
  && __velarDesktopBridgeDescriptor.value && typeof __velarDesktopBridgeDescriptor.value === "object"
  ? __velarDesktopBridgeDescriptor.value
  : null;
const __velarDesktopInvokeDescriptor = __velarDesktopBridge === null
  ? null
  : __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, "invoke");
const __velarDesktopInvoke = __velarDesktopInvokeDescriptor && "value" in __velarDesktopInvokeDescriptor
  && typeof __velarDesktopInvokeDescriptor.value === "function"
  ? __velarDesktopInvokeDescriptor.value
  : null;
function __velarDesktopRequireBridge() {
  if (__velarDesktopBridge === null) throw new Error("VelarScript Desktop bridge is unavailable");
  if (__velarDesktopInvoke === null) throw new TypeError("Desktop bridge invoke must be a function data value");
  return __velarDesktopBridge;
}
function __velarDesktopHostField(name) {
  const descriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopRequireBridge(), name);
  if (!descriptor || !("value" in descriptor)) throw new TypeError("Desktop bridge field '" + name + "' must be a data value");
  return descriptor.value;
}
function __velarDesktopHostCall(capability, operation, args, timeout = 30000) {
  const bridge = __velarDesktopRequireBridge();
  return __velarDesktopReflectApply(__velarDesktopInvoke, bridge, [capability, operation, args, timeout]);
}