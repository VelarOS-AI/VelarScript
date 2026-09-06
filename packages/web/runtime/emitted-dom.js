const __velarSvgNamespace = "http://www.w3.org/2000/svg";
const __velarXlinkNamespace = "http://www.w3.org/1999/xlink";
const __velarXmlNamespace = "http://www.w3.org/XML/1998/namespace";

function __velarCreateElement(tag, namespace) {
  return namespace === "svg" || tag === "svg"
    ? __velarDomCreateElementNS(__velarSvgNamespace, tag)
    : __velarDomCreateElement(tag);
}

function __velarListSnapshot(value, name) {
  value = __velarToRaw(value);
  __velarRuntime.collectionRead(value, __velarWebIterateKey, undefined);
  return __velarDomListSnapshot(value, name);
}

function __velarAppend(parent, value, state = null) {
  state ??= { active: __velarDomCreateSet(), depth: 0, values: 0, text: 0 };
  if (value == null || value === false || value === true) return;
  state.values += 1;
  if (state.values > 1000000) throw new RangeError("JSX cannot render more than 1000000 values");
  if (typeof value === "string") {
    state.text += value.length;
    if (state.text > 16 * 1024 * 1024) throw new RangeError("JSX text cannot exceed 16 MiB");
    __velarDomAppend(parent, __velarDomCreateTextNode(value));
    return;
  }
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX numbers must be finite");
    __velarDomAppend(parent, __velarDomCreateTextNode(__velarDomString(value)));
    return;
  }
  if (__velarDomIsNode(value)) { __velarDomAppend(parent, value); return; }
  if (__velarDomIsArray(value)) {
    if (state.depth >= 128) throw new RangeError("JSX Lists cannot exceed 128 nested levels");
    if (__velarDomSetContains(state.active, value)) throw new TypeError("JSX cannot render a cyclic List");
    const values = __velarListSnapshot(value, "JSX children");
    __velarDomSetInsert(state.active, value);
    state.depth += 1;
    try {
      for (let index = 0; index < values.length; index += 1) __velarAppend(parent, values[index], state);
    } finally {
      state.depth -= 1;
      __velarDomSetRemove(state.active, value);
    }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}

// The rendering region currently being constructed. A 'children' slot is built
// by the position that shows it and must be destroyed with it, so the slot is
// owned by this scope rather than by the caller's component scope, which would
// keep every hidden build's observers alive for the component's whole lifetime.
let __velarBuildScope = null;

function __velarChildrenNode(build, scope) {
  const owner = __velarBuildScope === null ? scope : __velarBuildScope;
  return __velarInternalRead(() => build(owner));
}

// The scalar half of __velarAppend, lifted out so a region that can only ever
// hold one text node can be that text node. The two branches are __velarAppend's
// own, error text included: the checked type admits an unsound value only where
// the program lied about it, and such a value must land exactly where it landed
// before -- rendered if it is text or a finite number, refused with the same
// message otherwise.
function __velarTextValue(value) {
  if (typeof value === "string") {
    if (value.length > 16 * 1024 * 1024) throw new RangeError("JSX text cannot exceed 16 MiB");
    return value;
  }
  if (typeof value === "number") {
    if (!__velarDomIsFinite(value)) throw new TypeError("JSX numbers must be finite");
    return __velarDomString(value);
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}

// F1: an interpolation whose checked type is 'string' or 'number' renders
// exactly one text node -- never zero, never markup, never a list. So it needs
// no comment pair to bracket content that can never grow or vanish, and no
// child scope to own observers that can never exist: the text node is its own
// anchor and its own content, created once and updated by assigning its data.
// That is the same node identity a comment anchor gave, so a keyed row that
// starts or ends on one still finds its bounds, and a focused sibling is never
// detached by an update.
function __velarText(parent, read, scope) {
  let node = null;
  __velarObserver(() => {
    // Read and validate before touching the document: a failed update must
    // leave the last valid text standing, exactly as a failed rebuild leaves
    // the last valid region standing.
    const value = __velarTextValue(read());
    if (node === null) __velarDomAppend(parent, node = __velarDomCreateTextNode(value));
    else __velarDomSetData(node, value);
  }, "dom", scope);
}

function __velarDynamic(parent, read, scope, rootState = null) {
  const start = __velarDomCreateComment("velar:start");
  const end = __velarDomCreateComment("velar:end");
  __velarDomAppend(parent, start, end);
  let nodes = [];
  let childScope = null;
  __velarAppendOwned(scope.mounts, () => { if (childScope) __velarMountScope(childScope); });
  __velarObserver(() => {
    const nextScope = __velarScope(scope.component);
    const fragment = __velarDomCreateFragment();
    let nextHost = null;
    const previousBuildScope = __velarBuildScope;
    __velarBuildScope = nextScope;
    try {
      __velarAppend(fragment, read(nextScope));
      if (rootState) nextHost = __velarRootHost(fragment, "dynamic component");
    }
    catch (error) { __velarDestroyScope(nextScope); throw error; }
    finally { __velarBuildScope = previousBuildScope; }
    const nextNodes = __velarDomChildNodes(fragment);
    if (childScope) __velarDestroyScope(childScope);
    for (let index = 0; index < nodes.length; index += 1) __velarDomRemove(nodes[index]);
    __velarDomBefore(end, fragment);
    childScope = nextScope;
    nodes = nextNodes;
    if (rootState) {
      rootState.host = nextHost;
      for (const listener of __velarGraphSetItems(rootState.listeners)) listener(nextHost);
    }
    if (scope.mounted) __velarMountScope(nextScope);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    if (childScope) __velarDestroyScope(childScope);
    for (let index = 0; index < nodes.length; index += 1) __velarDomRemove(nodes[index]);
    nodes = [];
    if (rootState) {
      rootState.host = null;
      for (const listener of __velarGraphSetItems(rootState.listeners)) listener(null);
    }
  });
}

function __velarDynamicComponent(read, scope) {
  const fragment = __velarDomCreateFragment();
  const rootState = { host: null, listeners: __velarGraphCreateSet() };
  __velarGraphDefine(fragment, "__velarDynamicRoot", { value: rootState });
  __velarDynamic(fragment, read, scope, rootState);
  return fragment;
}

function __velarKeyed(parent, read, keyOf, render, scope) {
  const start = __velarDomCreateComment("velar:keyed-start");
  const end = __velarDomCreateComment("velar:keyed-end");
  __velarDomAppend(parent, start, end);
  let entries = __velarGraphCreateMap();
  __velarAppendOwned(scope.mounts, () => { for (const entry of __velarGraphMapItems(entries)) __velarMountScope(entry.scope); });
  __velarObserver(() => {
    const source = __velarToRaw(read() ?? []);
    const values = __velarListSnapshot(source, "Keyed JSX");
    const next = __velarGraphCreateMap();
    const created = [];
    try {
      for (let index = 0; index < values.length; index += 1) {
        const rawValue = __velarToRaw(values[index]);
        // The keyed source may be a fresh derived List on every render. A row
        // is observed directly by its child scope, so linking it to that
        // ephemeral container only retains dead Lists and slows later writes.
        const trackedValue = __velarReactive(rawValue);
        const key = __velarKey(keyOf(trackedValue));
        if (__velarGraphMapContains(next, key)) throw new Error("Duplicate JSX key '" + (typeof key === "string" ? key : __velarDomString(key)) + "'");
        let entry = __velarGraphMapRead(entries, key);
        if (entry && !__velarGraphSame(entry.value, rawValue)) entry = undefined;
        if (!entry) {
          const childScope = __velarScope(scope.component);
          const fragment = __velarDomCreateFragment();
          const previousBuildScope = __velarBuildScope;
          __velarBuildScope = childScope;
          try { __velarAppend(fragment, render(trackedValue, childScope)); }
          catch (error) { __velarDestroyScope(childScope); throw error; }
          finally { __velarBuildScope = previousBuildScope; }
          // A row is held by its first and last top-level nodes, never by a
          // snapshot of the list between them: every dynamic construct brackets
          // itself with comments created once, so those two nodes are stable
          // while everything between them is replaced over time. Caching the
          // whole list put destroyed nodes back into the document on a later
          // reorder and stranded the live ones outside their own markers.
          const rowNodes = __velarDomChildNodes(fragment);
          entry = {
            value: rawValue,
            scope: childScope,
            first: rowNodes.length > 0 ? rowNodes[0] : null,
            last: rowNodes.length > 0 ? rowNodes[rowNodes.length - 1] : null,
            fragment,
          };
          created[created.length] = entry;
        }
        __velarGraphMapWrite(next, key, entry);
      }
    } catch (error) {
      for (let index = 0; index < created.length; index += 1) __velarDestroyScope(created[index].scope);
      throw error;
    }
    for (const key of __velarGraphMapKeyItems(entries)) {
      const entry = __velarGraphMapRead(entries, key);
      if (__velarGraphMapRead(next, key) === entry) continue;
      __velarDestroyScope(entry.scope);
      let node = entry.first;
      while (node !== null && node !== end) {
        const following = __velarDomNextSibling(node);
        __velarDomRemove(node);
        if (node === entry.last) break;
        node = following;
      }
    }
    // A row already standing in its final position must not be detached and
    // reattached: that moves focus off a live <input>, ends IME composition,
    // and resets transient subtree state. The cursor walks the surviving nodes
    // in order and only moves a node that is not already where it belongs.
    let cursor = __velarDomNextSibling(start);
    for (const entry of __velarGraphMapItems(next)) {
      if (entry.fragment) {
        __velarDomBefore(cursor === null ? end : cursor, entry.fragment);
        entry.fragment = null;
        if (scope.mounted) __velarMountScope(entry.scope);
        continue;
      }
      let node = entry.first;
      while (node !== null && node !== end) {
        const following = __velarDomNextSibling(node);
        if (node === cursor) cursor = __velarDomNextSibling(cursor);
        else __velarDomBefore(cursor === null ? end : cursor, node);
        if (node === entry.last) break;
        node = following;
      }
    }
    entries = next;
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    for (const entry of __velarGraphMapItems(entries)) __velarDestroyScope(entry.scope);
    __velarGraphMapEmpty(entries);
  });
}

