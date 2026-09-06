function __velarScope(component = "") {
  return { cleanups: [], mounts: [], mounted: false, component };
}

const __velarGlobalScope = __velarScope();

function __velarMountScope(scope) {
  if (scope.mounted) return;
  scope.mounted = true;
  for (let index = 0; index < scope.mounts.length; index += 1) {
    try {
      const result = __velarUntracked(scope.mounts[index]);
      __velarObservePromise(result, (error) => __velarReport(error, "mounted", scope));
    } catch (error) { __velarReport(error, "mounted", scope); }
  }
}

function __velarDestroyScope(scope) {
  for (let index = scope.cleanups.length - 1; index >= 0; index -= 1) {
    // A reentrant destroy can empty the list underneath this walk; a missing
    // slot means the step already ran and must not run again.
    const cleanup = scope.cleanups[index];
    if (typeof cleanup !== "function") continue;
    try {
      const result = __velarUntracked(cleanup);
      __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
    } catch (error) { __velarReport(error, "cleanup", scope); }
  }
  scope.cleanups.length = 0;
}

function __velarCleanupStep(run, scope) {
  try {
    const result = __velarUntracked(run);
    __velarObservePromise(result, (error) => __velarReport(error, "cleanup", scope));
  } catch (error) { __velarReport(error, "cleanup", scope); }
}

// D90 R21: nothing here asks whether this watch writes. Execution order is
// source order, so the only thing the flush needs of a watch is when it was
// registered, and __velarObserver stamps that on it. The label is the subject
// as the author spelled it, carried so a runaway flush can name the watches
// that ran away.
function __velarWatch(read, callback, scope, label = "") {
  let current;
  let currentVersion = 0;
  let initialized = false;
  let observer = null;
  observer = __velarObserver(() => {
    const next = read();
    __velarRuntime.trackDeep(next);
    const nextVersion = __velarRuntime.versionOf(next);
    if (initialized && (!__velarGraphSame(next, current) || nextVersion !== currentVersion)) {
      // The body is the author's effect, not part of the watched expression:
      // its own reactive reads must never become dependencies of what is being
      // watched, or one write re-evaluates the expression twice and an
      // unwatched value re-runs the watch.
      __velarUntracked(() => callback(next, current));
    }
    current = next;
    currentVersion = nextVersion;
    initialized = true;
  }, "watch", scope, label);
}

function __velarComponentHandle(value, componentName) {
  if (value === null || typeof value !== "object") throw new TypeError("Component " + componentName + " must expose an ordinary Handle record");
  const prototype = __velarGraphPrototype(value);
  if (prototype !== __velarGraphPrototype({}) && prototype !== null) throw new TypeError("Component " + componentName + " must expose an ordinary Handle record");
  const output = {};
  let active = true;
  const names = __velarGraphOwnNames(value);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const descriptor = __velarGraphOwnDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("Component " + componentName + " Handle fields must be enumerable data values");
    const member = typeof descriptor.value === "function"
      ? (...arguments_) => {
        if (!active) throw new Error("Component " + componentName + " Handle is no longer active");
        return __velarGraphApply(descriptor.value, null, arguments_, "component Handle method");
      }
      : descriptor.value;
    __velarGraphDefine(output, name, { enumerable: true, value: member });
  }
  return __velarGraphFreeze({
    value: __velarGraphFreeze(output),
    revoke() { active = false; },
  });
}

