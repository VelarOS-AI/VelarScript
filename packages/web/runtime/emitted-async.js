const __velarManagedAsyncNativePromise = globalThis.Promise;
const __velarManagedAsyncPromisePrototype = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "prototype")?.value;
const __velarManagedAsyncResolveOperation = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "resolve")?.value;
const __velarManagedAsyncRejectOperation = __velarGraphOwnDescriptor(__velarManagedAsyncNativePromise, "reject")?.value;
const __velarManagedAsyncThenOperation = __velarManagedAsyncPromisePrototype
  ? __velarGraphOwnDescriptor(__velarManagedAsyncPromisePrototype, "then")?.value
  : null;
function __velarManagedAsyncResolve(value) {
  return __velarGraphApply(__velarManagedAsyncResolveOperation, __velarManagedAsyncNativePromise, [value], "Promise.resolve");
}
function __velarManagedAsyncReject(error) {
  return __velarGraphApply(__velarManagedAsyncRejectOperation, __velarManagedAsyncNativePromise, [error], "Promise.reject");
}
function __velarManagedAsyncThen(value, fulfilled, rejected) {
  return __velarGraphApply(__velarManagedAsyncThenOperation, value, [fulfilled, rejected], "Promise.then");
}
function __velarManagedAsyncCreate(executor) {
  if (typeof __velarManagedAsyncNativePromise !== "function") throw new TypeError("The JavaScript Promise API is unavailable");
  return new __velarManagedAsyncNativePromise(executor);
}

function __velarResource(load, scope, name) {
  const value = __velarState(null);
  const loading = __velarState(true);
  const ready = __velarState(false);
  const error = __velarState(null);
  let generation = 0;
  let started = false;
  let disposed = false;

  const reload = () => {
    if (disposed) return __velarManagedAsyncResolve(null);
    started = true;
    const current = ++generation;
    loading.set(true);
    error.set(null);
    return __velarManagedAsyncThen(__velarManagedAsyncThen(__velarManagedAsyncResolve(), load),
      (next) => {
        if (disposed || current !== generation) return null;
        value.set(next);
        ready.set(true);
        loading.set(false);
        return null;
      },
      (failure) => {
        if (disposed || current !== generation) return null;
        const report = __velarRuntime.report(failure, { phase: "resource", detail: name, component: scope.component, unhandled: false });
        error.set(report.error);
        ready.set(true);
        loading.set(false);
        return null;
      },
    );
  };

  __velarAppendOwned(scope.mounts, () => started ? null : reload());
  __velarAppendOwned(scope.cleanups, () => { disposed = true; generation += 1; });
  return __velarGraphFreeze({
    get value() { return value.get(); },
    get loading() { return loading.get(); },
    get ready() { return ready.get(); },
    get error() { return error.get(); },
    reload,
  });
}

function __velarAction(execute, scope, name) {
  const pending = __velarState(false);
  const error = __velarState(null);
  let active = 0;
  let generation = 0;
  let disposed = false;

  const run = (...arguments_) => {
    // D114 W2: the one place an action call enters the runtime. An action
    // started from inside an observer run is asynchronous work that observer
    // started, so the reactive window carries into the flush its completion
    // schedules; started from anywhere else it records nothing.
    __velarNoteAsyncWork();
    if (disposed) return __velarManagedAsyncReject(__velarNormalizeError(
      "Action '" + name + "' cannot run after its component is destroyed",
    ));
    const current = ++generation;
    active += 1;
    pending.set(true);
    error.set(null);
    return __velarManagedAsyncThen(__velarManagedAsyncThen(__velarManagedAsyncResolve(), () => __velarGraphApply(execute, null, arguments_, "action body")),
      (value) => {
        active -= 1;
        if (!disposed) pending.set(active > 0);
        return value;
      },
      (failure) => {
        active -= 1;
        let actionError = __velarNormalizeError(failure);
        if (!disposed) {
          pending.set(active > 0);
          // Every action failure reports exactly once, through the action
          // phase, carrying the action's name as its detail -- including a
          // failure superseded by a newer call. Only the newest generation
          // owns the public error field. The actionFailures mark lets the
          // event and detached observers of the same rejection skip an
          // already-reported failure instead of reporting it a second time.
          const report = __velarRuntime.report(failure, { phase: "action", detail: name, component: scope.component, unhandled: false });
          actionError = report.error;
          __velarGraphWeakSetInsert(__velarRuntime.actionFailures, actionError);
          if (current === generation) error.set(report.error);
        }
        throw actionError;
      },
    );
  };

  __velarGraphDefine(run, "pending", { enumerable: true, get: () => pending.get() });
  __velarGraphDefine(run, "error", { enumerable: true, get: () => error.get() });
  __velarAppendOwned(scope.cleanups, () => { disposed = true; generation += 1; });
  return __velarGraphFreeze(run);
}

