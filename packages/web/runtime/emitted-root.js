const __velarRootHosts = __velarGraphCreateWeakMap();

function __velarRootHostResolve(root) {
  const elements = [];
  const children = __velarDomChildNodes(root);
  for (let index = 0; index < children.length; index += 1) {
    if (__velarDomNodeType(children[index]) === 1) __velarAppendOwned(elements, children[index]);
  }
  const explicit = [];
  const forwarded = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    // A nested component's own, perfectly legal host is that component's, not
    // this one's, at the root level exactly as below it. Every root-level node
    // of a nested component carries the marker and this component's own nodes
    // do not yet — construction marks them after a caller's look binds — so
    // the marker is what separates the two. Reading 'host' first counted a
    // nested component's marked root as a second host of the enclosing one and
    // collapsed the whole region, which is the buried-host defect standing at
    // the root level instead of below it. Such a node is not this component's
    // host but the host this component forwards to when it declares none of
    // its own, so it is collected apart rather than dropped.
    if (__velarDomOwnData(element, "__velarComponentNode") === true) {
      if (__velarDomOwnData(element, "__velarHost") === true) __velarAppendOwned(forwarded, element);
      continue;
    }
    if (__velarDomOwnData(element, "__velarHost") === true) { __velarAppendOwned(explicit, element); continue; }
    // A walk that refuses to enter a marked node stops at a nested component's
    // boundary whatever depth its host sits at; a flat 'querySelectorAll' scan
    // could only skip the marked node itself and still counted a host one level
    // below it.
    const pending = [element];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const nodes = __velarDomChildNodes(pending[cursor]);
      for (let child = 0; child < nodes.length; child += 1) {
        const node = nodes[child];
        if (__velarDomNodeType(node) !== 1) continue;
        if (__velarDomOwnData(node, "__velarComponentNode") === true) continue;
        if (__velarDomOwnData(node, "__velarHost") === true) __velarAppendOwned(explicit, node);
        __velarAppendOwned(pending, node);
      }
    }
  }
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return "A component can declare only one host element";
  // Nothing of this component's own is marked, so a single nested component
  // root hands its host on. Two of them leave nothing to forward to, and the
  // component has to mark a native element of its own to settle it.
  if (forwarded.length === 1) return forwarded[0];
  if (forwarded.length > 1) return "A component with multiple roots must mark exactly one native element with 'host'";
  if (elements.length === 1) return elements[0];
  return "A component with multiple roots must mark exactly one native element with 'host'";
}

function __velarRootHost(root, capability) {
  if (root == null) throw new TypeError("A component with multiple roots must mark exactly one native element with 'host'");
  if (__velarDomNodeType(root) === 1) return root;
  let resolved = __velarGraphWeakMapRead(__velarRootHosts, root);
  if (resolved === undefined) {
    resolved = __velarRootHostResolve(root);
    __velarGraphWeakMapWrite(__velarRootHosts, root, resolved);
  }
  if (typeof resolved === "string") throw new TypeError(resolved);
  return resolved;
}

function __velarLookBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarLookBind(__velarRootHost(root, "look"), read, scope);
    return;
  }
  const source = { rules: __velarGraphCreateRecord() };
  let host = null;
  const move = (next) => {
    __velarMoveLookSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.rules = __velarLook([read()]).rules;
    if (host) __velarApplyLooks(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

function __velarClassBindRoot(root, read, scope) {
  const dynamic = __velarDynamicRootState(root);
  if (!dynamic) {
    __velarClassBind(__velarRootHost(root, "class"), read, scope);
    return;
  }
  const source = { names: [] };
  let host = null;
  const move = (next) => {
    __velarMoveClassSource(source, host, next);
    host = next;
  };
  __velarGraphSetInsert(dynamic.listeners, move);
  move(dynamic.host);
  __velarObserver(() => {
    source.names = __velarClassNames(read());
    if (host) __velarApplyClasses(host);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarGraphSetRemove(dynamic.listeners, move);
    move(null);
  });
}

function __velarClassNames(value, output = []) {
  if (value == null || value === false) return output;
  if (__velarGraphIsList(value)) {
    for (let index = 0; index < value.length; index += 1) __velarClassNames(value[index], output);
    return output;
  }
  if (typeof value !== "string") throw new TypeError("class accepts strings, string?, or lists of strings");
  let name = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === " " || character === "\t" || character === "\n" || character === "\r" || character === "\f" || character === "\v") {
      if (name !== "") __velarAppendOwned(output, name);
      name = "";
      continue;
    }
    name += character;
  }
  if (name !== "") __velarAppendOwned(output, name);
  return output;
}

function __velarApplyClasses(element) {
  const sources = __velarGraphWeakMapRead(__velarRuntime.classSources, element);
  const next = __velarGraphCreateSet();
  if (sources) {
    for (const source of __velarGraphSetItems(sources)) {
      for (let index = 0; index < source.names.length; index += 1) __velarGraphSetInsert(next, source.names[index]);
    }
  }
  const state = __velarElementState(element, "__velarClassState", () => __velarGraphFreeze({
    base: __velarGraphCreateSet(__velarDomClassNames(element)),
    managed: __velarGraphCreateSet(),
  }));
  for (const name of __velarGraphSetItems(state.managed)) {
    if (!__velarGraphSetContains(next, name) && !__velarGraphSetContains(state.base, name)) __velarDomClassRemove(element, name);
  }
  for (const name of __velarGraphSetItems(next)) __velarDomClassInsert(element, name);
  __velarGraphSetEmpty(state.managed);
  for (const name of __velarGraphSetItems(next)) __velarGraphSetInsert(state.managed, name);
}

function __velarMoveClassSource(source, previous, next) {
  if (previous) {
    __velarDetachSource(__velarRuntime.classSources, previous, source);
    __velarApplyClasses(previous);
  }
  if (next) {
    __velarAttachSource(__velarRuntime.classSources, next, source);
    __velarApplyClasses(next);
  }
}

function __velarClassBind(element, read, scope) {
  const source = { names: [] };
  __velarAttachSource(__velarRuntime.classSources, element, source);
  __velarObserver(() => {
    source.names = __velarClassNames(read());
    __velarApplyClasses(element);
  }, "dom", scope);
  __velarAppendOwned(scope.cleanups, () => {
    __velarDetachSource(__velarRuntime.classSources, element, source);
    __velarApplyClasses(element);
  });
}

