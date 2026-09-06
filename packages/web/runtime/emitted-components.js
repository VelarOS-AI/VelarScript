function __velarComponent(node, scope, mounted, cleanup, handleState) {
  let destroyed = false;
  const refCleanups = [];
  const ownedNodes = node && __velarDomNodeType(node) === 11 ? __velarDomChildNodes(node) : [node];
  // An enclosing component forwards to a nested component's host only when that
  // component's root sits at its own root level. Marking the nodes here is what
  // lets the enclosing scan walk past a nested host buried inside one of its
  // own elements instead of counting it as a second host of its own.
  for (let index = 0; index < ownedNodes.length; index += 1) {
    if (ownedNodes[index] && __velarDomNodeType(ownedNodes[index]) === 1) {
      __velarGraphDefine(ownedNodes[index], "__velarComponentNode", { value: true, enumerable: true, configurable: true });
    }
  }
  if (mounted) __velarAppendOwned(scope.mounts, mounted);
  return {
    __velarComponent: true,
    node,
    __bindRef(setRef) {
      if (!handleState) throw new TypeError("This component does not expose a Handle");
      const handle = handleState.value;
      let bound = true;
      setRef(handle, undefined);
      __velarAppendOwned(refCleanups, () => {
        if (!bound) return;
        bound = false;
        setRef(null, handle);
      });
      return null;
    },
    mount(target, before = null) {
      if (destroyed) throw new Error("Cannot mount a destroyed VelarScript component");
      if (scope.mounted) throw new Error("Cannot mount a VelarScript component more than once");
      const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      __velarDomInsertBefore(parent, node, before);
      __velarMountScope(scope);
      return null;
    },
    __mount() { if (!destroyed) __velarMountScope(scope); },
    destroy(remove = true) {
      if (destroyed) return null;
      destroyed = true;
      for (let index = refCleanups.length - 1; index >= 0; index -= 1) refCleanups[index]();
      refCleanups.length = 0;
      if (handleState) handleState.revoke();
      if (cleanup) {
        try {
          const result = __velarUntracked(cleanup);
          __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
        } catch (error) { __velarReport(error, "cleanup", scope); }
      }
      __velarDestroyScope(scope);
      if (remove) for (let index = 0; index < ownedNodes.length; index += 1) __velarDomRemove(ownedNodes[index]);
      return null;
    },
  };
}

function __velarScopeComponentRoot(node, attribute) {
  if (!attribute || !node) return;
  if (__velarDomNodeType(node) === 1) {
    __velarDomSetAttribute(node, attribute, "");
    return;
  }
  if (__velarDomNodeType(node) === 11) {
    const children = __velarDomChildNodes(node);
    for (let index = 0; index < children.length; index += 1) {
      if (__velarDomNodeType(children[index]) === 1) __velarDomSetAttribute(children[index], attribute, "");
    }
  }
}

function __velarUseComponent(instance, scope, parentStyleScope = "") {
  __velarScopeComponentRoot(instance.node, parentStyleScope);
  __velarAppendOwned(scope.mounts, () => instance.__mount());
  __velarAppendOwned(scope.cleanups, () => instance.destroy(false));
  return instance.node;
}

// D114 P6 item 5 (LC-C2): the compiler-owned fatal state, as one element. The
// root replaces a mount target with it; a dynamic region that threw while it
// was first constructed renders it in place of the position it could not build.
// Both are the same element with the same role and the same attribute, because
// they are the same promise -- "no blank page" -- kept at two scales, and an
// assistive technology has to find them the same way.
function __velarFatalNode(message) {
  const fallback = __velarDomCreateElement("section");
  __velarDomSetAttribute(fallback, "role", "alert");
  __velarDomSetAttribute(fallback, "data-velar-fatal", "");
  __velarDomSetText(fallback, message);
  return fallback;
}

function __velarFatal(parent, error) {
  __velarDomReplaceChildren(parent, __velarFatalNode("The application could not start: " + error.message));
}

// Whether any root has actually mounted, which is the whole question the
// deferred module failure below has to answer: the no-blank-page promise is
// about a page with nothing on it, and a page that already has an application
// on it is not one the fatal state may replace.
let __velarMountedRoot = false;

// A component element built while the module evaluates sits outside every
// transaction the runtime owns, so a construction throw there used to escape
// module evaluation and leave the page blank -- the one initial-render path the
// promise did not cover. The failure is caught into this value instead, and the
// module keeps evaluating so the '@main' region still runs: that is where the
// error handlers are installed and where 'mount' is called, and reporting ahead
// of both would report to nobody.
function __velarModuleInstantiate(component, thunks, children, scope, namespace, setRef) {
  try {
    return __velarInstantiate(component, thunks, children, scope, namespace, setRef);
  } catch (error) {
    const failure = { error, surfaced: false };
    // The mount that takes this root surfaces the failure at its own target.
    // Nothing having taken it by the first microtask means nothing ever will,
    // and a root that was built to be mounted and never was is still a blank
    // page: it surfaces there instead, into the document body.
    __velarEnqueue(() => __velarSurfaceModuleFailure(failure, null));
    return { __velarModuleFailure: failure };
  }
}

function __velarSurfaceModuleFailure(failure, parent) {
  if (failure.surfaced) return null;
  failure.surfaced = true;
  // The phase is 'mount' because this is the same failure 'mount(<App />, ...)'
  // reports under that phase; the two spellings of one root differ in where the
  // element is written, not in what went wrong.
  const report = __velarReport(failure.error, "mount", null);
  try {
    const target = parent ?? (__velarMountedRoot ? null : __velarDomQuerySelector("body"));
    if (target) __velarFatal(target, report.error);
  } catch {}
  return null;
}

function __velarMount(evaluate, fallbackTarget = null) {
  let values;
  try {
    values = evaluate();
  } catch (failure) {
    const report = __velarReport(failure, "mount", null);
    if (fallbackTarget !== null) {
      try {
        const fallback = __velarDomQuerySelector(fallbackTarget);
        if (fallback) __velarFatal(fallback, report.error);
      } catch {}
    }
    return null;
  }
  const value = values[0];
  const target = values[1];
  const parent = typeof target === "string" ? __velarDomQuerySelector(target) : target;
  // A root whose construction failed while the module evaluated is answered
  // here, ahead of the missing-target question: the construction failure is the
  // cause, and reporting the target instead would name a symptom. The target
  // still decides where the fatal state renders, and a missing one falls back
  // to the document body exactly as it does below.
  if (value && value.__velarModuleFailure) {
    __velarSurfaceModuleFailure(value.__velarModuleFailure, parent || null);
    return null;
  }
  if (!parent) {
    // A missing mount target must keep the no-blank-page promise in every
    // build: the failure is reported through velar/app and the fatal state
    // renders into the document body, since the requested target is exactly
    // what does not exist.
    const report = __velarReport(new Error("VelarScript mount target was not found"), "mount", null);
    try {
      const body = __velarDomQuerySelector("body");
      if (body) __velarFatal(body, report.error);
    } catch {}
    return null;
  }
  try {
    if (value && value.__velarComponent) {
      const result = value.mount(parent);
      if (__velarGraphIsList(globalThis.__velarHotDisposers)) __velarAppendOwned(globalThis.__velarHotDisposers, () => value.destroy());
      __velarMountedRoot = true;
      return result;
    }
    __velarAppend(parent, value);
    __velarMountScope(__velarGlobalScope);
    __velarMountedRoot = true;
    return null;
  } catch (failure) {
    const report = __velarReport(failure, "mount", null);
    __velarFatal(parent, report.error);
    return null;
  }
}

