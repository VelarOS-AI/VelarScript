let __velarReactiveCollectionBridge = null;
function __velarResolveReactiveCollectionBridge() {
  if (__velarReactiveCollectionBridge) return __velarReactiveCollectionBridge;
  const bridge = __velarResolveReactiveBridge();
  if (!bridge) return null;
  const collectionRead = __velarReactiveBridgeField(bridge.runtime, "collectionRead");
  const collectionTrigger = __velarReactiveBridgeField(bridge.runtime, "collectionTrigger");
  const collectionUnlink = __velarReactiveBridgeField(bridge.runtime, "collectionUnlink");
  const reactive = __velarReactiveBridgeField(bridge.runtime, "reactive");
  const track = __velarReactiveBridgeField(bridge.runtime, "track");
  if (typeof collectionRead !== "function" || typeof collectionTrigger !== "function"
    || typeof collectionUnlink !== "function" || typeof reactive !== "function" || typeof track !== "function") {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive collection runtime values are invalid");
  }
  __velarReactiveCollectionBridge = { runtime: bridge.runtime, toRaw: bridge.toRaw, collectionRead, collectionTrigger, collectionUnlink, reactive, track };
  return __velarReactiveCollectionBridge;
}
function __velarReactiveCollectionRead(value, key, child) {
  if (child === undefined) child = null;
  const bridge = __velarResolveReactiveCollectionBridge();
  return bridge ? bridge.collectionRead(value, key, child) : child;
}
function __velarReactiveCollectionTrack(value, key = __velarReactiveIterateKey) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.track(bridge.toRaw(value), key);
}
function __velarReactiveCollectionLink(value, child) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.reactive(child, bridge.toRaw(value));
}
function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.collectionTrigger(value, key, iterate, structure, indexFrom, allKeys);
}
function __velarReactiveCollectionUnlink(value, child) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.collectionUnlink(value, child);
}
