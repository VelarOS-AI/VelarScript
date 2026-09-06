function __velarHtml(element, read, scope) {
  __velarObserver(() => {
    const value = read();
    if (value != null && typeof value !== "string") throw new TypeError("unsafe:html requires string or null");
    if (value?.length > 16 * 1024 * 1024) throw new RangeError("unsafe:html cannot exceed 16 MiB");
    __velarDomSetHtml(element, value ?? "");
  }, "dom", scope);
}

function __velarOn(element, event, read, scope, modifiers = []) {
  if (typeof __velarInternalRead(read) !== "function") throw new TypeError("Event '" + event + "' requires a function");
  const capture = __velarHasName(modifiers, "capture");
  const once = __velarHasName(modifiers, "once");
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    __velarDomRemoveListener(element, event, listener, capture);
  };
  const listener = (value) => {
    try {
      if (__velarHasName(modifiers, "self")) {
        const target = __velarEventField(value, "target", __velarEventTargetGetter);
        if (target === __velarEventMissingField) throw new TypeError("DOM event does not expose a native target");
        if (target !== element) return;
      }
      // 'once' is spent here rather than through the native option, so the
      // documented order -- self, then prevent, then stop, then the handler --
      // holds for it too. The native option removes the registration on the
      // first dispatch that merely reaches the element, which for 'self' is
      // exactly the dispatch the handler must not see: 'on:click.self.once'
      // could then never run at all.
      if (once) remove();
      if (__velarHasName(modifiers, "prevent")) __velarEventCall(value, "preventDefault", __velarEventPreventDefault);
      if (__velarHasName(modifiers, "stop")) __velarEventCall(value, "stopPropagation", __velarEventStopPropagation);
      // The handler expression is re-read per dispatch so handlers routed
      // through live props always see the current value.
      const handler = __velarInternalRead(read);
      if (typeof handler !== "function") throw new TypeError("Event '" + event + "' requires a function");
      const result = __velarUntracked(() => handler(value));
      __velarObservePromise(result, (error) => __velarReportEvent(error, scope, event));
    } catch (error) { __velarReportEvent(error, scope, event); }
  };
  __velarDomAddListener(element, event, listener, { capture });
  __velarAppendOwned(scope.cleanups, remove);
}

function __velarBindValue(element, state, scope, numeric = false, parse = null) {
  __velarObserver(() => {
    const value = state.get();
    if (value == null) __velarDomSetFieldValue(element, "");
    else if (numeric) {
      if (typeof value !== "number" || !__velarDomIsFinite(value)) throw new TypeError("Numeric bind:value requires a finite number");
      __velarDomSetFieldValue(element, __velarDomString(value));
    } else {
      if (typeof value !== "string") throw new TypeError("bind:value requires text");
      __velarDomSetFieldValue(element, value);
    }
  }, "dom", scope);
  const update = () => state.set(numeric ? __velarDomFieldNumber(element) : parse ? parse(__velarDomFieldValue(element)) : __velarDomFieldValue(element));
  __velarDomAddListener(element, "input", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "input", update, false));
}

function __velarBindGroupValues(state, own) {
  const value = __velarInternalRead(() => state.get());
  const values = __velarListSnapshot(value, "bind:group state");
  const output = new __velarDomNativeArray(values.length);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (typeof item !== "string") throw new TypeError("bind:group on a checkbox requires List<string> state");
    if (item !== own) { output[count] = item; count += 1; }
  }
  output.length = count;
  return output;
}

function __velarBindGroup(element, state, scope, multiple = false, parse = null) {
  __velarObserver(() => {
    const own = __velarDomFieldValue(element);
    const value = state.get();
    if (!multiple) {
      if (value != null && typeof value !== "string") throw new TypeError("bind:group requires text state");
      __velarDomSetFieldChecked(element, value === own);
      return;
    }
    const values = __velarListSnapshot(value, "bind:group state");
    let present = false;
    for (let index = 0; index < values.length; index += 1) if (values[index] === own) present = true;
    __velarDomSetFieldChecked(element, present);
  }, "dom", scope);
  const update = () => {
    const own = __velarDomFieldValue(element);
    if (!multiple) {
      if (__velarDomFieldChecked(element)) state.set(parse ? parse(own) : own);
      return;
    }
    const remaining = __velarBindGroupValues(state, own);
    if (__velarDomFieldChecked(element)) remaining[remaining.length] = own;
    state.set(remaining);
  };
  __velarDomAddListener(element, "change", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "change", update, false));
}

function __velarBindChecked(element, state, scope) {
  __velarObserver(() => {
    const value = state.get();
    if (typeof value !== "boolean") throw new TypeError("bind:checked requires bool");
    __velarDomSetFieldChecked(element, value);
  }, "dom", scope);
  const update = () => state.set(__velarDomFieldChecked(element));
  __velarDomAddListener(element, "change", update, false);
  __velarAppendOwned(scope.cleanups, () => __velarDomRemoveListener(element, "change", update, false));
}

// Prop handles give a component body live reads over its props store. The
// component function still runs exactly once per instance; only reads race
// ahead, so state initializers can never re-run on a prop update.
