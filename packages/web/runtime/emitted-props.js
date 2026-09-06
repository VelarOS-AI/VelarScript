function __velarPropProvided(props, name) {
  // A children slot is rendered content rather than a value thunk. Asking for
  // its value to decide whether the required slot exists would build the slot
  // once here and again at the JSX position that owns it. Its own property is
  // the presence proof; the first value read remains the one rendering read.
  if (name === "children") return __velarGraphOwnDescriptor(props, name) !== undefined;
  return __velarInternalRead(() => props[name]) !== undefined;
}

function __velarRequiredProp(props, name, component) {
  if (!__velarPropProvided(props, name)) throw new TypeError("Component " + component + " requires prop " + name);
  return __velarGraphFreeze({
    get() {
      const value = props[name];
      if (value === undefined) throw new TypeError("Component " + component + " requires prop " + name);
      return value;
    },
  });
}

function __velarProp(props, name, fallback) {
  const fallbackValue = __velarPropProvided(props, name) ? undefined : fallback();
  return __velarGraphFreeze({
    get() {
      const value = props[name];
      return value === undefined ? fallbackValue : value;
    },
  });
}

function __velarBindComponentRef(instance, setRef) {
  if (setRef === undefined) return instance;
  if (!instance || typeof instance.__bindRef !== "function") throw new TypeError("This component does not expose a Handle");
  instance.__bindRef(setRef);
  return instance;
}

// Holds every prop's cache open for the length of one construction. The graph
// records a dependency for whichever observer is running, so forcing the props
// under this one keeps them clean while the component function runs: a read
// during construction is served from the value the force produced, and a
// tracked read still subscribes the observer that made it. Releasing the hold
// hands each prop over to whatever actually observes it, which is the second
// half of the rule -- recomputed on demand, cached while observed.
function __velarConstructionHold() {
  return {
    mode: "computed",
    stopped: false,
    running: false,
    selfInvalidations: 0,
    dependencies: __velarGraphCreateSet(),
    spareDependencies: null,
    notify() {},
    run() {},
  };
}

// Instantiates a component with a live props store: each prop is a cached
// derived value the props object exposes as a tracked getter, so a prop
// expression that nothing reads costs nothing after construction. The component
// call itself is untracked so construction can never subscribe an enclosing
// dynamic region to prop reads.
function __velarInstantiate(component, thunks, children, scope, namespace, setRef) {
  const props = {};
  // 'style:' on a component host is the caller decorating the instance's root,
  // the way it decorates a native element. The slot the compiler inserts for it
  // is not a field the component declares, so it is bound here rather than
  // handed inward -- a component the runtime implements validates its props
  // against the fields it does declare and would refuse an unknown one.
  const styleRead = thunks.__velarStyle;
  const propNames = __velarGraphOwnNames(thunks);
  const accesses = [];
  for (let index = 0; index < propNames.length; index += 1) {
    const name = propNames[index];
    if (name === "__velarStyle") continue;
    // A prop is a derived value, not an eagerly pushed one: an unconditional
    // observer per prop re-ran every prop expression on every dependency
    // change, including the expensive ones behind props the component never
    // reads. The cache is the same one a declared derived value uses.
    const access = __velarComputed(thunks[name]);
    accesses[accesses.length] = access;
    __velarGraphDefine(props, name, { enumerable: true, get: () => access.get() });
  }
  // 'children' follows Vel's ordinary rules: it is rendered content owned by
  // the position that shows it, rebuilt whenever that position renders again.
  // As a one-shot fragment value it could be shown exactly once, and the first
  // time a conditional position hid it the content was destroyed for good.
  if (children !== undefined) __velarGraphDefine(props, "children", { enumerable: true, get: () => __velarChildrenNode(children, scope) });
  const instance = __velarUntracked(() => {
    if (accesses.length === 0) return component(props, namespace);
    // Component JSX evaluates the way the charter says a JavaScript object
    // literal does: every prop expression runs once, in the order the caller
    // wrote it, and only then does the component function run. 'children' is
    // not one of them -- it is rendered content owned by the position that
    // shows it, so a position that never shows it never builds it.
    const hold = __velarConstructionHold();
    try {
      __velarRuntime.runTracked(hold, () => {
        for (let index = 0; index < accesses.length; index += 1) accesses[index].get();
      });
      return component(props, namespace);
    } finally { __velarCleanupObserver(hold); }
  });
  if (styleRead !== undefined) __velarStyleBindRoot(instance.node, styleRead, scope);
  return __velarBindComponentRef(instance, setRef);
}

// A component element in child position: one stable instance whose prop
// observers live in a dedicated scope, destroyed only when the position
// itself unmounts. Construction failures stay contained to the position.
function __velarChild(component, thunks, children, scope, namespace, setRef) {
  const childScope = __velarScope(scope.component);
  let constructed = false;
  __velarAppendOwned(scope.mounts, () => { if (constructed) __velarMountScope(childScope); });
  __velarAppendOwned(scope.cleanups, () => { if (constructed) __velarDestroyScope(childScope); });
  try {
    const node = __velarUseComponent(__velarInstantiate(component, thunks, children, childScope, namespace, setRef), childScope);
    constructed = true;
    return node;
  } catch (error) {
    __velarDestroyScope(childScope);
    // D114 P6 item 5 (LC-C2): the position that could not be built leaves the
    // compiler-owned fatal state, scoped to itself. It used to leave an HTML
    // comment -- invisible to the reader and to assistive technology alike --
    // so "the initial render never leaves a blank page" was true of the root
    // and false one node in. The isolation is unchanged: siblings mount and
    // keep running, and the failure is still reported in the `render` phase.
    const report = __velarReport(error, "render", scope);
    // The namespace this position renders into, so the marker is an element the
    // surrounding document can actually lay out (F7-web-b).
    return __velarFatalNode("This part of the page could not start: " + report.error.message, namespace);
  }
}

// tick() promises the settled flush, so it drains the reactive queues instead
// of hopping one microtask and hoping. Each round runs the pending flush and
// yields, so work an observer queued asynchronously is picked up too; the round
// count is bounded for the same reason the flush budget is, and the flush's own
// budget is what ends a runaway cycle.
