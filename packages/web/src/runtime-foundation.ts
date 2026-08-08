import { VELAR_ERROR_NORMALIZATION_RUNTIME } from "@velarscript/compiler/extension";

export const WEB_RUNTIME_FOUNDATION = String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
const __velarRuntimeKey = Symbol.for("velar.runtime.v1");
const __velarRuntimeFields = Object.freeze([
  "version", "domQueue", "watchQueue", "flushPending", "activeObserver", "errorHandlers",
  "actionFailures", "lookSources", "classSources", "dependencies", "rawToProxy", "proxyToRaw",
  "versions", "parents", "toRaw", "reactive", "track", "trackDeep", "trigger", "versionOf",
  "collectionRead", "collectionTrigger", "collectionUnlink", "report", "applyLook", "installLook",
]);

function __velarRuntimeCollection(value, kind) {
  try {
    if (kind === "Set") Set.prototype.has.call(value, value);
    else if (kind === "WeakSet") WeakSet.prototype.has.call(value, value);
    else WeakMap.prototype.has.call(value, value);
    return true;
  } catch { return false; }
}

function __velarReportOptions(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("VelarScript error report options must be a record");
  }
  const allowed = new Set(["phase", "detail", "component", "unhandled"]);
  const output = { phase: "runtime", detail: "", component: "", unhandled: false };
  for (const name of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(name)) throw new TypeError("Unknown VelarScript error report option '" + name + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("VelarScript error report options cannot use accessors");
    const next = descriptor.value;
    if (name === "unhandled") {
      if (typeof next !== "boolean") throw new TypeError("VelarScript error report unhandled must be bool");
      output.unhandled = next;
    } else {
      if (typeof next !== "string") throw new TypeError("VelarScript error report " + name + " must be a string");
      const maximum = name === "phase" ? 256 : name === "component" ? 1024 : 65536;
      if (next.length > maximum) throw new RangeError("VelarScript error report " + name + " is too long");
      output[name] = next;
    }
  }
  return output;
}

function __velarObservePromise(value, onRejected) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  try { return Promise.prototype.then.call(value, undefined, onRejected); }
  catch { return null; }
}

function __velarCreateRuntime() {
  const runtime = Object.create(null);
  const domQueue = Object.freeze(new Set());
  const watchQueue = Object.freeze(new Set());
  const errorHandlers = Object.freeze(new Set());
  const actionFailures = Object.freeze(new WeakSet());
  const lookSources = Object.freeze(new WeakMap());
  const classSources = Object.freeze(new WeakMap());
  const dependencies = Object.freeze(new WeakMap());
  const rawToProxy = Object.freeze(new WeakMap());
  const proxyToRaw = Object.freeze(new WeakMap());
  const versions = Object.freeze(new WeakMap());
  const parents = Object.freeze(new WeakMap());
  const iterateKey = Symbol.for("velar.reactive.iterate.v1");
  const deepKey = Symbol.for("velar.reactive.deep.v1");
  let lookImplementation = null;
  const toRaw = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
    return WeakMap.prototype.get.call(proxyToRaw, value) ?? value;
  };
  const track = (target, key) => {
    target = toRaw(target);
    const observer = runtime.activeObserver;
    if (!observer || observer.stopped || (typeof target !== "object" && typeof target !== "function") || target === null) return;
    let byKey = WeakMap.prototype.get.call(dependencies, target);
    if (!byKey) { byKey = new Map(); WeakMap.prototype.set.call(dependencies, target, byKey); }
    let subscribers = byKey.get(key);
    if (!subscribers) { subscribers = new Set(); byKey.set(key, subscribers); }
    subscribers.add(observer);
    observer.dependencies.add(subscribers);
  };
  const notify = (target, key) => {
    const subscribers = WeakMap.prototype.get.call(dependencies, target)?.get(key);
    if (subscribers) for (const observer of [...subscribers]) observer.notify();
  };
  const bump = (target) => {
    WeakMap.prototype.set.call(versions, target, (WeakMap.prototype.get.call(versions, target) ?? 0) + 1);
  };
  const trigger = (target, key, iterate = false) => {
    target = toRaw(target);
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return;
    const visited = new Set();
    const bubble = (current, direct) => {
      if (visited.has(current)) return;
      visited.add(current);
      bump(current);
      if (direct) {
        notify(current, key);
        if (iterate) notify(current, iterateKey);
      }
      notify(current, deepKey);
      const owners = WeakMap.prototype.get.call(parents, current);
      if (owners) for (const owner of owners) bubble(owner, false);
    };
    bubble(target, true);
  };
  const link = (child, parent) => {
    child = toRaw(child);
    parent = toRaw(parent);
    if (!child || (typeof child !== "object" && typeof child !== "function")
      || !parent || (typeof parent !== "object" && typeof parent !== "function") || child === parent) return;
    let owners = WeakMap.prototype.get.call(parents, child);
    if (!owners) { owners = new Set(); WeakMap.prototype.set.call(parents, child, owners); }
    owners.add(parent);
  };
  const unlink = (child, parent) => {
    child = toRaw(child);
    parent = toRaw(parent);
    const owners = child && (typeof child === "object" || typeof child === "function")
      ? WeakMap.prototype.get.call(parents, child)
      : null;
    if (owners) {
      owners.delete(parent);
      if (owners.size === 0) WeakMap.prototype.delete.call(parents, child);
    }
  };
  const contains = (parent, child) => {
    parent = toRaw(parent);
    child = toRaw(child);
    if (Array.isArray(parent)) {
      for (let index = 0; index < parent.length; index += 1) {
        if (toRaw(Object.getOwnPropertyDescriptor(parent, index)?.value) === child) return true;
      }
      return false;
    }
    try {
      Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(parent);
      for (const value of Map.prototype.values.call(parent)) if (toRaw(value) === child) return true;
      return false;
    } catch {}
    try {
      Reflect.getOwnPropertyDescriptor(Set.prototype, "size").get.call(parent);
      for (const value of Set.prototype.values.call(parent)) if (toRaw(value) === child) return true;
      return false;
    } catch {}
    if (!parent || typeof parent !== "object") return false;
    for (const name of Object.getOwnPropertyNames(parent)) {
      const descriptor = Object.getOwnPropertyDescriptor(parent, name);
      if (descriptor && "value" in descriptor && toRaw(descriptor.value) === child) return true;
    }
    return false;
  };
  const reactive = (value, parent = null) => {
    value = toRaw(value);
    if (parent) link(value, parent);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.isExtensible(value)) return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    let proxy = WeakMap.prototype.get.call(rawToProxy, value);
    if (proxy) return proxy;
    proxy = new Proxy(value, {
      get(target, key) {
        track(target, key);
        return reactive(Reflect.get(target, key, target), target);
      },
      set(target, key, next) {
        next = toRaw(next);
        const present = Reflect.has(target, key);
        const previous = toRaw(Reflect.get(target, key, target));
        const changed = !Object.is(previous, next);
        const written = Reflect.set(target, key, next, target);
        if (!written || !changed) return written;
        link(next, target);
        if (!contains(target, previous)) unlink(previous, target);
        trigger(target, key, !present);
        return true;
      },
      has(target, key) { track(target, key); return Reflect.has(target, key); },
      deleteProperty(target, key) {
        if (!Reflect.has(target, key)) return true;
        const previous = toRaw(Reflect.get(target, key, target));
        const deleted = Reflect.deleteProperty(target, key);
        if (deleted) {
          if (!contains(target, previous)) unlink(previous, target);
          trigger(target, key, true);
        }
        return deleted;
      },
    });
    WeakMap.prototype.set.call(rawToProxy, value, proxy);
    WeakMap.prototype.set.call(proxyToRaw, proxy, value);
    return proxy;
  };
  const trackDeep = (value) => { value = toRaw(value); track(value, deepKey); return value; };
  const versionOf = (value) => {
    value = toRaw(value);
    return value && (typeof value === "object" || typeof value === "function")
      ? WeakMap.prototype.get.call(versions, value) ?? 0
      : 0;
  };
  const collectionRead = (value, key, child) => {
    value = toRaw(value);
    track(value, key);
    return reactive(child, value);
  };
  const collectionTrigger = (value, key, iterate = true) => trigger(toRaw(value), key, iterate);
  const collectionUnlink = (value, child) => { value = toRaw(value); if (!contains(value, child)) unlink(child, value); };
  const report = (value, options) => {
    const error = __velarNormalizeError(value);
    const checked = __velarReportOptions(options);
    const timestamp = globalThis.Date.now();
    if (!Number.isFinite(timestamp)) throw new TypeError("The browser returned an invalid error timestamp");
    const errorReport = Object.freeze({
      error,
      phase: checked.phase,
      detail: checked.detail,
      component: checked.component,
      timestamp,
    });
    let handled = false;
    for (const handler of Set.prototype.values.call(errorHandlers)) {
      handled = true;
      try {
        const result = handler(errorReport);
        __velarObservePromise(result, (failure) => queueMicrotask(() => { throw __velarNormalizeError(failure); }));
      } catch (failure) { queueMicrotask(() => { throw __velarNormalizeError(failure); }); }
    }
    if (checked.unhandled && !handled) queueMicrotask(() => { throw error; });
    return errorReport;
  };
  const applyLook = (...arguments_) => {
    if (!lookImplementation) throw new TypeError("Link Look requires the VelarScript Web runtime");
    return lookImplementation(...arguments_);
  };
  const installLook = (implementation) => {
    if (typeof implementation !== "function") throw new TypeError("VelarScript Look integration requires a function");
    lookImplementation ??= implementation;
    return null;
  };
  const fields = {
    version: "0.11", domQueue, watchQueue, flushPending: false, activeObserver: null, errorHandlers,
    actionFailures, lookSources, classSources, dependencies, rawToProxy, proxyToRaw, versions, parents,
    toRaw, reactive, track, trackDeep, trigger, versionOf, collectionRead, collectionTrigger, collectionUnlink,
    report, applyLook, installLook,
  };
  for (const name of __velarRuntimeFields) Object.defineProperty(runtime, name, {
    value: fields[name],
    enumerable: false,
    configurable: false,
    writable: name === "flushPending" || name === "activeObserver",
  });
  return Object.preventExtensions(runtime);
}

function __velarRequireRuntime(value) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== null || Object.isExtensible(value)
    || Object.getOwnPropertySymbols(value).length > 0) throw new TypeError("VelarScript Web runtime ownership is invalid");
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== __velarRuntimeFields.length || __velarRuntimeFields.some((name) => !names.includes(name))) {
    throw new TypeError("VelarScript Web runtime fields are invalid");
  }
  for (const name of __velarRuntimeFields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    const mutable = name === "flushPending" || name === "activeObserver";
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable !== mutable) {
      throw new TypeError("VelarScript Web runtime field '" + name + "' is invalid");
    }
  }
  if (value.version !== "0.11"
    || !__velarRuntimeCollection(value.domQueue, "Set") || !__velarRuntimeCollection(value.watchQueue, "Set")
    || typeof value.flushPending !== "boolean" || (value.activeObserver !== null && typeof value.activeObserver !== "object")
    || !__velarRuntimeCollection(value.errorHandlers, "Set") || !__velarRuntimeCollection(value.actionFailures, "WeakSet")
    || !__velarRuntimeCollection(value.lookSources, "WeakMap") || !__velarRuntimeCollection(value.classSources, "WeakMap")
    || !__velarRuntimeCollection(value.dependencies, "WeakMap") || !__velarRuntimeCollection(value.rawToProxy, "WeakMap")
    || !__velarRuntimeCollection(value.proxyToRaw, "WeakMap") || !__velarRuntimeCollection(value.versions, "WeakMap")
    || !__velarRuntimeCollection(value.parents, "WeakMap")
    || typeof value.toRaw !== "function" || typeof value.reactive !== "function" || typeof value.track !== "function"
    || typeof value.trackDeep !== "function" || typeof value.trigger !== "function" || typeof value.versionOf !== "function"
    || typeof value.collectionRead !== "function" || typeof value.collectionTrigger !== "function" || typeof value.collectionUnlink !== "function"
    || typeof value.report !== "function" || typeof value.applyLook !== "function" || typeof value.installLook !== "function") {
    throw new TypeError("VelarScript Web runtime values are invalid");
  }
  return value;
}

const __velarRuntime = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
      throw new TypeError("VelarScript Web runtime registry ownership is invalid");
    }
    return __velarRequireRuntime(descriptor.value);
  }
  const runtime = __velarCreateRuntime();
  Object.defineProperty(globalThis, __velarRuntimeKey, {
    value: runtime,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return runtime;
})();
`.trimStart();
