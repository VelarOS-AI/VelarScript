function component(node, mounted, cleanup) {
  let destroyed = false;
  let ready = false;
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
      if (ready) throw new Error("Cannot mount a VelarScript component more than once");
      const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      __velarDomInsertBefore(parent, node, before);
      this.__mount();
      return null;
    },
    __mount() { if (!destroyed && !ready) { ready = true; if (mounted) mounted(); } },
    destroy(remove = true) { if (!destroyed) { destroyed = true; if (cleanup) cleanup(); if (remove) __velarDomRemove(node); } return null; },
  };
}

function append(parent, value, state = null) {
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
    const values = __velarRequireList(value, "JSX children");
    __velarDomSetInsert(state.active, value);
    state.depth += 1;
    try { for (const item of values) append(parent, item, state); }
    finally { state.depth -= 1; __velarDomSetRemove(state.active, value); }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}
