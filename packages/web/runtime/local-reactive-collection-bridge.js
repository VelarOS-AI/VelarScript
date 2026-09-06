const __velarReactiveIterateKey = Symbol.for("velar.reactive.iterate.v1");
const __velarReactiveStructureKey = Symbol.for("velar.reactive.structure.v1");
const __velarReactiveCollectionReadOperation = __velarRuntime.collectionRead;
const __velarReactiveCollectionTriggerOperation = __velarRuntime.collectionTrigger;
const __velarReactiveCollectionUnlinkOperation = __velarRuntime.collectionUnlink;
const __velarReactiveOperation = __velarRuntime.reactive;
const __velarReactiveTrackOperation = __velarRuntime.track;
function __velarReactiveCollectionRead(value, key, child) { return __velarReactiveCollectionReadOperation(value, key, child === undefined ? null : child); }
function __velarReactiveCollectionTrack(value, key = __velarReactiveIterateKey) { __velarReactiveTrackOperation(__velarToRaw(value), key); }
function __velarReactiveCollectionLink(value, child) { __velarReactiveOperation(child, __velarToRaw(value)); }
function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) { __velarReactiveCollectionTriggerOperation(value, key, iterate, structure, indexFrom, allKeys); }
function __velarReactiveCollectionUnlink(value, child) { __velarReactiveCollectionUnlinkOperation(value, child); }
