import { VELAR_ERROR_NORMALIZATION_RUNTIME, VELAR_STRICT_JSON_RUNTIME } from "@velarscript/compiler/extension";
import { WEB_RUNTIME_FOUNDATION } from "./runtime-foundation.ts";

const ownedCallbackRuntime = String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
function __velarReportOwnedCallback(failure, phase, detail) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (runtime && typeof runtime.report === "function") runtime.report(error, { phase, detail, unhandled: true });
  else queueMicrotask(() => { throw error; });
}
function __velarObserveOwnedPromise(value, onRejected) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  try { return Promise.prototype.then.call(value, undefined, onRejected); }
  catch { return null; }
}
function __velarInvokeOwnedCallback(callback, arguments_, phase, detail) {
  if (callback == null) return;
  try {
    const result = callback(...arguments_);
    __velarObserveOwnedPromise(result, (failure) => __velarReportOwnedCallback(failure, phase, detail));
  } catch (failure) {
    __velarReportOwnedCallback(failure, phase, detail);
  }
}
function __velarInvokeOwnedRead(read, callback, phase, detail) {
  try { __velarInvokeOwnedCallback(callback, [read()], phase, detail); }
  catch (failure) { __velarReportOwnedCallback(failure, phase, detail); }
}
`.trimStart();

const fileRegistryRuntime = String.raw`
const nativeFilesKey = Symbol.for("velar.file.registry.v1");
const nativeFiles = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, nativeFilesKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("VelarScript file registry cannot be an accessor");
    if (descriptor.configurable || descriptor.enumerable || descriptor.writable) throw new TypeError("VelarScript file registry ownership is invalid");
    try { WeakMap.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("VelarScript file registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakMap();
  Object.defineProperty(globalThis, nativeFilesKey, { value: registry, enumerable: false, configurable: false, writable: false });
  return registry;
})();
const __velarNativeFileName = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "name")?.get : null;
const __velarNativeFileModified = typeof File === "function" ? Object.getOwnPropertyDescriptor(File.prototype, "lastModified")?.get : null;
const __velarNativeBlobSize = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get : null;
const __velarNativeBlobType = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "type")?.get : null;
const __velarNativeBlobText = typeof Blob === "function" ? Object.getOwnPropertyDescriptor(Blob.prototype, "text")?.value : null;
function __velarReadNativeFileField(operation, file) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native File API");
  try { return operation.call(file); }
  catch { throw new TypeError("A file picker returned an invalid native File"); }
}
function __velarNativeFile(value, message) {
  const file = value && WeakMap.prototype.get.call(nativeFiles, value);
  if (!file) throw new TypeError(message);
  try {
    if (typeof __velarNativeFileName !== "function") throw new TypeError();
    __velarNativeFileName.call(file);
  } catch { throw new TypeError(message); }
  return file;
}
`.trimStart();

const listRuntime = String.raw`
const __velarMaxListItems = 1000000;
function __velarRequireList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(name + " requires a List");
  if (value.length > __velarMaxListItems) throw new RangeError(name + " cannot exceed " + __velarMaxListItems + " items");
  if (Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw new TypeError(name + " requires a dense List without extra fields");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !lengthDescriptor.writable || lengthDescriptor.enumerable
    || lengthDescriptor.configurable || !("value" in lengthDescriptor)) {
    throw new TypeError(name + " requires an ordinary mutable List length");
  }
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !descriptor.configurable || !descriptor.writable || !("value" in descriptor)) {
      throw new TypeError(name + " requires ordinary mutable List elements");
    }
    output[index] = descriptor.value;
  }
  return output;
}
`.trimStart();

const optionsRuntime = String.raw`
function __velarOptions(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(name + " must be a record");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(name + " cannot contain symbol fields");
  const output = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key)) throw new TypeError("Unknown " + name + " field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " field '" + key + "' must be an enumerable data value");
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}
function __velarString(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); return value; }
function __velarBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
`.trimStart();

const runtimeTypeRuntime = String.raw`
const __velarRuntimeTypeRegistryKey = Symbol.for("velar.type.registry.v1");
const __velarRuntimeTypeRegistry = (() => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, __velarRuntimeTypeRegistryKey);
  if (descriptor) {
    if (!("value" in descriptor)) throw new TypeError("VelarScript runtime type registry cannot be an accessor");
    try { WeakSet.prototype.has.call(descriptor.value, descriptor.value); }
    catch { throw new TypeError("VelarScript runtime type registry is invalid"); }
    return descriptor.value;
  }
  const registry = new WeakSet();
  Object.defineProperty(globalThis, __velarRuntimeTypeRegistryKey, {
    value: registry,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return registry;
})();
function __velarRegisterRuntimeType(value) { __velarRuntimeTypeRegistry.add(value); return value; }
function __velarRequireRuntimeType(value, name, optional = false) {
  if (optional && value == null) return null;
  if (!value || typeof value !== "object" || !WeakSet.prototype.has.call(__velarRuntimeTypeRegistry, value)) {
    throw new TypeError(name + " requires a compiler-known VelarScript runtime type");
  }
  return value;
}
`.trimStart();

export const webModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/app", String.raw`
${WEB_RUNTIME_FOUNDATION}

export function onError(handler) {
  if (typeof handler !== "function") throw new TypeError("onError requires a callback");
  if (!__velarRuntime.errorHandlers.has(handler) && __velarRuntime.errorHandlers.size >= 1000) throw new RangeError("An application cannot install more than 1000 error handlers");
  __velarRuntime.errorHandlers.add(handler);
  return () => { __velarRuntime.errorHandlers.delete(handler); return null; };
}

export function reportError(error, phase = "manual", detail = "") {
  if (!Error.isError(error)) throw new TypeError("reportError requires an Error");
  if (typeof phase !== "string" || typeof detail !== "string") throw new TypeError("reportError phase and detail must be strings");
  if (phase.length > 256 || detail.length > 65536) throw new RangeError("reportError phase/detail text is too long");
  __velarRuntime.report(error, { phase, detail, unhandled: false });
  return null;
}
  `.trimStart()],
  ["velar/config", String.raw`
${runtimeTypeRuntime}
const source = "__VELAR_PUBLIC_CONFIG__";
function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}
const value = freeze(source);
export function publicConfig(Type) { Type = __velarRequireRuntimeType(Type, "publicConfig"); return Type.parse(value); }
export function has(key) { if (typeof key !== "string") throw new TypeError("Config keys must be strings"); return Object.prototype.hasOwnProperty.call(value, key); }
export function keys() { return Object.keys(value).sort(); }
`.trimStart()],
  ["velar/web", String.raw`
${VELAR_ERROR_NORMALIZATION_RUNTIME}
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
const appBase = "__VELAR_WEB_BASE__";
let nextDomId = 1;

export function domId(prefix = "velar") {
  prefix = __velarString(prefix, "DOM ID prefix");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(prefix)) throw new TypeError("DOM ID prefixes must start with a letter and contain only letters, numbers, underscores, or hyphens");
  if (prefix.length > 64) throw new RangeError("DOM ID prefixes cannot exceed 64 characters");
  if (!Number.isSafeInteger(nextDomId)) throw new RangeError("The VelarScript DOM ID space is exhausted");
  return prefix + "-" + nextDomId++;
}

function isBoundedStringMap(value) {
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { return false; }
  if (size > 100000) return false;
  let codeUnits = 0;
  for (const [key, item] of Map.prototype.entries.call(value)) {
    if (typeof key !== "string" || typeof item !== "string") return false;
    codeUnits += key.length + item.length;
    if (codeUnits > 2 * 1024 * 1024) return false;
  }
  return true;
}

function checkedRouteContext(value) {
  try {
    const fields = __velarOptions(value, "RouteContext", new Set(["path", "params", "query", "hash"]));
    if (Object.keys(fields).length !== 4 || typeof fields.path !== "string" || fields.path.length > 2 * 1024 * 1024
      || !isBoundedStringMap(fields.params) || !isBoundedStringMap(fields.query)
      || typeof fields.hash !== "string" || fields.hash.length > 2 * 1024 * 1024) return null;
    return value;
  } catch { return null; }
}

export const RouteContext = __velarRegisterRuntimeType(Object.freeze({
  is(value) { return checkedRouteContext(value) !== null; },
  parse(value) {
    if (checkedRouteContext(value) === null) throw new TypeError("RouteContext requires bounded path/hash text and string params/query Maps");
    return value;
  },
}));

function validateRoutePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("A VelarScript route path must start with '/'");
  if (path.length > 8192) throw new RangeError("A VelarScript route path cannot exceed 8192 code units");
  if (path.includes("?") || path.includes("#")) throw new TypeError("A VelarScript route path describes only a pathname");
  if (path.includes("\\")) throw new TypeError("A VelarScript route path cannot contain a backslash");
  if (path.length > 1 && path.endsWith("/")) throw new TypeError("A VelarScript route path cannot end with '/'");
  const names = new Set();
  const segments = path.split("/").slice(1);
  for (const [index, segment] of segments.entries()) {
    if (!segment && path !== "/") throw new TypeError("A VelarScript route path cannot contain an empty segment");
    if (segment === "*") {
      if (index !== segments.length - 1) throw new TypeError("A VelarScript route wildcard must be the final segment");
      if (names.has("wildcard")) throw new TypeError("A VelarScript route parameter named 'wildcard' conflicts with the '*' capture");
      names.add("wildcard");
      continue;
    }
    if (segment.includes("*")) throw new TypeError("A VelarScript route wildcard must occupy its whole final segment");
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new TypeError("A VelarScript route parameter requires a valid name");
    if (names.has(name)) throw new TypeError("A VelarScript route parameter cannot be repeated: " + name);
    names.add(name);
  }
  return path;
}

function compileRoutePath(path) {
  const names = [];
  const source = path.split("/").map((part) => {
    if (part === "*") { names.push("wildcard"); return "(.*)"; }
    if (part.startsWith(":")) { names.push(part.slice(1)); return "([^/]+)"; }
    return part.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  }).join("/");
  return Object.freeze({ names: Object.freeze(names), pattern: new RegExp("^" + source + "/?$") });
}

export function route(path, component) {
  path = validateRoutePath(path);
  if (typeof component !== "function") throw new TypeError("A VelarScript route component must be callable");
  return Object.freeze({ path, component });
}

export function lazy(loader, exportName, loading = null, failed = null) {
  if (typeof loader !== "function") throw new TypeError("VelarScript lazy requires a module loader");
  if (typeof exportName !== "string" || !exportName) throw new TypeError("VelarScript lazy requires an exported component name");
  if (exportName.length > 4096) throw new RangeError("VelarScript lazy export names cannot exceed 4096 characters");
  if (loading != null && typeof loading !== "function") throw new TypeError("VelarScript lazy loading fallback must be a component");
  if (failed != null && typeof failed !== "function") throw new TypeError("VelarScript lazy failure fallback must be a component");

  let resolved = null;
  let pending = null;
  const load = () => {
    if (resolved) return Promise.resolve(resolved);
    if (!pending) {
      pending = Promise.resolve().then(loader).then((module) => {
        const target = module && module[exportName];
        if (typeof target !== "function") throw new TypeError("Dynamically loaded module has no component export '" + exportName + "'");
        resolved = target;
        return target;
      }).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };

  return function VelarLazy(props = {}, namespace = "html") {
    const svg = namespace === "svg";
    const host = svg
      ? document.createElementNS("http://www.w3.org/2000/svg", "g")
      : document.createElement("velar-lazy");
    if (!svg) host.style.display = "contents";
    let active = loading ? loading({}, namespace) : null;
    if (active != null && !active.__velarComponent) throw new TypeError("VelarScript lazy loading fallback must render a component");
    let mounted = false;
    let destroyed = false;
    if (active && active.__velarComponent) host.append(active.node);
    else host.append(document.createComment("lazy component loading"));

    const replace = (next) => {
      if (!next || !next.__velarComponent) throw new TypeError("VelarScript lazy fallbacks must render components");
      if (destroyed) { next.destroy(); return; }
      if (active && active.__velarComponent) active.destroy(false);
      active = next;
      host.replaceChildren(next.node);
      if (mounted) next.__mount();
    };

    const fail = (value) => {
      const error = __velarNormalizeError(value);
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      runtime?.report?.(error, { phase: "resource", detail: "lazy:" + exportName, component: exportName, unhandled: false });
      try {
        if (failed) replace(failed({ error }, namespace));
        else {
          const message = svg
            ? document.createElementNS("http://www.w3.org/2000/svg", "text")
            : document.createElement("div");
          message.setAttribute("role", "alert");
          message.textContent = "Unable to load " + exportName;
          replace(component(message));
        }
      } catch (fallbackFailure) {
        const fallbackError = __velarNormalizeError(fallbackFailure);
        runtime?.report?.(fallbackError, { phase: "render", detail: "lazy-fallback:" + exportName, component: exportName, unhandled: false });
        if (active && active.__velarComponent) active.destroy(false);
        active = null;
        if (!destroyed) {
          const message = svg
            ? document.createElementNS("http://www.w3.org/2000/svg", "text")
            : document.createElement("div");
          message.setAttribute("role", "alert");
          message.textContent = "Unable to render " + exportName;
          host.replaceChildren(message);
        }
      }
    };

    void load().then((target) => replace(target(props, namespace))).catch(fail);

    return component(host, () => {
      mounted = true;
      if (active && active.__velarComponent) active.__mount();
    }, () => {
      destroyed = true;
      if (active && active.__velarComponent) active.destroy(false);
    });
  };
}

export function navigate(to, options = {}) {
  options = __velarOptions(options, "Navigation options", new Set(["replace", "scroll"]));
  const replace = options.replace ?? false;
  const scroll = options.scroll ?? true;
  __velarBool(replace, "Navigation replace");
  __velarBool(scroll, "Navigation scroll");
  const href = internalHref(to);
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
  if (scroll) requestAnimationFrame(() => globalThis.scrollTo({ top: 0, left: 0 }));
  return null;
}

export function redirect(to) {
  return navigate(to, { replace: true });
}

export function back() {
  history.back();
  return null;
}

export function forward() {
  history.forward();
  return null;
}

export function reload() {
  location.reload();
  return null;
}

export function currentRoute() {
  const path = applicationPath(location.pathname) ?? "/";
  return Object.freeze({ path, params: new Map(), query: queryValues(), hash: routeHash() });
}

export function Head(props) {
  props = __velarOptions(props, "Head props", new Set(["title", "description", "canonical", "robots", "image", "themeColor", "language"]));
  let { title, description = "", canonical = "", robots = "", image = "", themeColor = "", language = "" } = props;
  title = __velarString(title, "Head title");
  description = __velarString(description, "Head description");
  canonical = __velarString(canonical, "Head canonical URL");
  robots = __velarString(robots, "Head robots");
  image = __velarString(image, "Head image");
  themeColor = __velarString(themeColor, "Head theme color");
  language = __velarString(language, "Head language");
  if (title.length > 4096) throw new RangeError("Head titles cannot exceed 4096 characters");
  if (description.length > 65536) throw new RangeError("Head descriptions cannot exceed 64 KiB");
  if (canonical.length > 2 * 1024 * 1024 || image.length > 2 * 1024 * 1024) throw new RangeError("Head URLs cannot exceed 2 MiB");
  if (robots.length > 4096) throw new RangeError("Head robots cannot exceed 4096 characters");
  if (themeColor.length > 256) throw new RangeError("Head theme colors cannot exceed 256 characters");
  if (language.length > 256) throw new RangeError("Head language tags cannot exceed 256 characters");
  if (language && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)) {
    throw new TypeError("Head language must be a simple BCP 47 language tag");
  }
  const node = document.createComment("velar head");
  let previousTitle = "";
  let previousLanguage = null;
  let restorers = [];
  return component(node, () => {
    previousTitle = document.title;
    document.title = title;
    previousLanguage = document.documentElement.getAttribute("lang");
    if (language) document.documentElement.setAttribute("lang", language);
    restorers = [
      ownHead('meta[name="description"]', "meta", "name", "description", "content", description),
      ownHead('link[rel="canonical"]', "link", "rel", "canonical", "href", canonical),
      ownHead('meta[name="robots"]', "meta", "name", "robots", "content", robots),
      ownHead('meta[property="og:image"]', "meta", "property", "og:image", "content", image),
      ownHead('meta[name="theme-color"]', "meta", "name", "theme-color", "content", themeColor),
    ];
  }, () => {
    if (document.title === title) document.title = previousTitle;
    if (language && document.documentElement.getAttribute("lang") === language) {
      if (previousLanguage == null) document.documentElement.removeAttribute("lang");
      else document.documentElement.setAttribute("lang", previousLanguage);
    }
    for (const restore of restorers.reverse()) restore();
  });
}

function ownHead(selector, tag, identityName, identityValue, valueName, value) {
  if (!value) return () => {};
  let element = document.head.querySelector(selector);
  const created = !element;
  if (!element) {
    element = document.createElement(tag);
    element.setAttribute(identityName, identityValue);
    document.head.append(element);
  }
  const previous = element.getAttribute(valueName);
  element.setAttribute(valueName, value);
  return () => {
    if (element.getAttribute(valueName) !== value) return;
    if (created) element.remove();
    else if (previous == null) element.removeAttribute(valueName);
    else element.setAttribute(valueName, previous);
  };
}

export function announce(message, priority = "polite") {
  message = __velarString(message, "Announcement message");
  if (message.length > 65536) throw new RangeError("Announcement messages cannot exceed 64 KiB");
  if (priority !== "polite" && priority !== "assertive") throw new TypeError("Announcement priority must be 'polite' or 'assertive'");
  let region = document.querySelector('[data-velar-announcer="' + priority + '"]');
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("data-velar-announcer", priority);
    region.setAttribute("role", priority === "assertive" ? "alert" : "status");
    region.setAttribute("aria-live", priority);
    region.setAttribute("aria-atomic", "true");
    region.style.cssText = "position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.append(region);
  }
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = message; });
  return null;
}

export function Router(props) {
  props = __velarOptions(props, "Router props", new Set(["routes", "fallback"]));
  let { routes, fallback = null } = props;
  const routeItems = __velarRequireList(routes, "Router routes");
  if (routeItems.length > 10000) throw new RangeError("A Router cannot contain more than 10000 routes");
  routes = routeItems.map((item) => {
    item = __velarOptions(item, "Router route", new Set(["path", "component"]));
    validateRoutePath(item.path);
    if (typeof item.component !== "function") throw new TypeError("A Router route component must be callable");
    return Object.freeze({ path: item.path, component: item.component, matcher: compileRoutePath(item.path) });
  });
  if (fallback != null && typeof fallback !== "function") throw new TypeError("A Router fallback must be a component");
  const node = document.createElement("velar-router");
  let active = null;
  let mounted = false;
  const notFound = ({ route }) => {
    const page = document.createElement("main");
    page.setAttribute("data-velar-not-found", "");
    const title = document.createElement("h1");
    title.textContent = "Page not found";
    const detail = document.createElement("p");
    detail.textContent = "No route matches " + route.path;
    page.append(title, detail);
    return component(page);
  };
  const render = () => {
    try {
      const path = applicationPath(location.pathname);
      const match = path === null ? null : matchRoute(routes, path);
      const context = match?.context ?? { path: path ?? "/", params: new Map(), query: queryValues(), hash: routeHash() };
      const next = match ? match.item.component({ route: context }) : (fallback ?? notFound)({ route: context });
      if (!next || !next.__velarComponent) throw new TypeError("A VelarScript Router target must render a component");
      if (active) active.destroy();
      active = next;
      node.replaceChildren(active.node);
      if (mounted) active.__mount();
    } catch (value) {
      const error = __velarNormalizeError(value);
      if (!mounted) throw error;
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      if (runtime && typeof runtime.report === "function") {
        runtime.report(error, { phase: "render", detail: "router", component: "Router", unhandled: true });
      } else {
        queueMicrotask(() => { throw error; });
      }
    }
  };
  const changed = () => render();
  render();
  return component(node, () => {
    mounted = true;
    addEventListener("popstate", changed);
    if (active) active.__mount();
  }, () => {
    removeEventListener("popstate", changed);
    if (active) active.destroy(false);
  });
}

export function Link(props) {
  props = __velarOptions(props, "Link props", new Set(["to", "replace", "class", "look", "children"]));
  let { to, replace = false, children } = props;
  to = __velarString(to, "Link target");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("Link targets cannot exceed 2 MiB");
  __velarBool(replace, "Link replace");
  const external = isExternal(to);
  const href = external ? to : internalHref(to);
  const node = document.createElement("a");
  const releaseHost = forwardHost(node, props);
  node.href = href;
  append(node, children);
  const clicked = (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (external) return;
    if (new URL(node.href, location.href).origin !== location.origin) return;
    event.preventDefault();
    navigate(to, { replace });
  };
  return component(node, () => node.addEventListener("click", clicked), () => { node.removeEventListener("click", clicked); releaseHost(); });
}

export function NavLink(props) {
  props = __velarOptions(props, "NavLink props", new Set(["to", "exact", "replace", "class", "look", "children"]));
  let { to, exact = false, replace = false, children } = props;
  to = __velarString(to, "NavLink target");
  __velarBool(exact, "NavLink exact");
  __velarBool(replace, "NavLink replace");
  internalHref(to);
  const linked = Link({ to, replace, class: props.class, look: props.look, children });
  const target = normalizeApplicationPath(new URL(to, "https://velar.invalid").pathname);
  const update = () => {
    const application = applicationPath(location.pathname);
    const current = application === null ? null : normalizeApplicationPath(application);
    const active = current !== null && (current === target || (!exact && target !== "/" && current.startsWith(target + "/")));
    if (active) linked.node.setAttribute("aria-current", "page");
    else linked.node.removeAttribute("aria-current");
  };
  update();
  return component(linked.node, () => {
    linked.__mount();
    addEventListener("popstate", update);
  }, () => {
    removeEventListener("popstate", update);
    linked.destroy(false);
  });
}

function forwardHost(node, props) {
  const cleanups = [];
  if (props.class != null) {
    if (typeof props.class !== "string") throw new TypeError("Link class must be a string");
    const names = props.class.split(/\s+/).filter(Boolean);
    node.classList.add(...names);
    cleanups.push(() => node.classList.remove(...names));
  }
  if (props.look != null) {
    const runtime = globalThis[Symbol.for("velar.runtime.v1")];
    if (!runtime || typeof runtime.applyLook !== "function") throw new TypeError("Link Look requires the VelarScript Web runtime");
    cleanups.push(runtime.applyLook(node, props.look));
  }
  return () => { for (const cleanup of cleanups.reverse()) cleanup(); };
}

function normalizeApplicationPath(path) {
  return path.length > 1 ? path.replace(/\/+$/u, "") : "/";
}

function matchRoute(routes, pathname) {
  for (const item of routes) {
    const result = item.matcher.pattern.exec(pathname);
    if (!result) continue;
    const params = new Map();
    let decodable = true;
    for (const [index, name] of item.matcher.names.entries()) {
      try { params.set(name, decodeURIComponent(result[index + 1] ?? "")); }
      catch { decodable = false; break; }
    }
    if (!decodable) continue;
    return { item, context: { path: pathname, params, query: queryValues(), hash: routeHash() } };
  }
  return null;
}

function applicationPath(pathname) {
  if (typeof pathname !== "string" || pathname.length > 2 * 1024 * 1024) throw new RangeError("Application paths cannot exceed 2 MiB");
  if (appBase === "/") return pathname;
  const prefix = appBase.slice(0, -1);
  if (pathname === prefix) return "/";
  return pathname.startsWith(appBase) ? "/" + pathname.slice(appBase.length) : null;
}

function internalHref(to) {
  if (typeof to !== "string" || !to.startsWith("/") || isExternal(to)) throw new TypeError("VelarScript navigation targets must be application paths starting with '/'");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("VelarScript navigation targets cannot exceed 2 MiB");
  const parsed = new URL(to, "https://velar.invalid");
  return appBase + parsed.pathname.slice(1) + parsed.search + parsed.hash;
}

function isExternal(to) {
  return typeof to === "string" && (/^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//"));
}

function queryValues() {
  const search = location.search;
  if (typeof search !== "string") throw new TypeError("Route queries require browser text");
  if (search.length > 2 * 1024 * 1024) throw new RangeError("Route queries cannot exceed 2 MiB");
  const output = new Map();
  let count = 0;
  for (const [name, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError("Route queries cannot exceed 100000 fields");
    output.set(name, value);
  }
  return output;
}

function routeHash() {
  const hash = location.hash;
  if (typeof hash !== "string") throw new TypeError("Route hashes require browser text");
  if (hash.length > 2 * 1024 * 1024) throw new RangeError("Route hashes cannot exceed 2 MiB");
  return hash;
}

function component(node, mounted, cleanup) {
  let destroyed = false;
  let ready = false;
  return {
    __velarComponent: true,
    node,
    mount(target, before = null) {
      const parent = typeof target === "string" ? document.querySelector(target) : target;
      if (!parent) throw new Error("VelarScript mount target was not found");
      parent.insertBefore(node, before);
      this.__mount();
      return null;
    },
    __mount() { if (!destroyed && !ready) { ready = true; if (mounted) mounted(); } },
    destroy(remove = true) { if (!destroyed) { destroyed = true; if (cleanup) cleanup(); if (remove) node.remove(); } return null; },
  };
}

function append(parent, value, state = null) {
  state ??= { active: new Set(), depth: 0, values: 0, text: 0 };
  if (value == null || value === false || value === true) return;
  state.values += 1;
  if (state.values > 1000000) throw new RangeError("JSX cannot render more than 1000000 values");
  if (typeof value === "string") {
    state.text += value.length;
    if (state.text > 16 * 1024 * 1024) throw new RangeError("JSX text cannot exceed 16 MiB");
    parent.append(document.createTextNode(value));
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JSX numbers must be finite");
    parent.append(document.createTextNode(String(value)));
    return;
  }
  if (typeof globalThis.Node !== "undefined" && value instanceof globalThis.Node) { parent.append(value); return; }
  if (Array.isArray(value)) {
    if (state.depth >= 128) throw new RangeError("JSX Lists cannot exceed 128 nested levels");
    if (state.active.has(value)) throw new TypeError("JSX cannot render a cyclic List");
    const values = __velarRequireList(value, "JSX children");
    state.active.add(value);
    state.depth += 1;
    try { for (const item of values) append(parent, item, state); }
    finally { state.depth -= 1; state.active.delete(value); }
    return;
  }
  throw new TypeError("JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values");
}
`.trimStart()],
  ["velar/forms", String.raw`
${listRuntime}
${optionsRuntime}
${runtimeTypeRuntime}
let nextErrorId = 1;
const pendingFields = new WeakMap();
const maxFormFields = 100000;
const maxFormTextCodeUnits = 16 * 1024 * 1024;
function formText(value, name, maximum = 1024) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function formNumber(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function formValue(value, name) {
  if (typeof value === "string" && value.length > maxFormTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function formList(values, name) {
  if (values.length > maxFormFields) throw new RangeError(name + " cannot exceed 100000 values");
  return values;
}
function formElements(form) {
  if (!Number.isSafeInteger(form.elements.length) || form.elements.length < 0) throw new TypeError("Form controls have an invalid length");
  if (form.elements.length > maxFormFields) throw new RangeError("Forms cannot exceed 100000 controls");
  return form.elements;
}
function formErrorNodes(form) {
  const nodes = form.querySelectorAll("[data-velar-field-error]");
  if (nodes.length > maxFormFields) throw new RangeError("Forms cannot exceed 100000 field errors");
  return nodes;
}
function formType(value) { return __velarRequireRuntimeType(value, "Form reading"); }
function decoderField(value) {
  value = __velarOptions(value, "Form decoder field", new Set(["name", "kind", "optional", "enumValues"]));
  const name = formText(value.name, "Form decoder field name");
  const kind = formText(value.kind, "Form decoder field kind", 64);
  if (!["string", "number", "bool", "enum", "strings"].includes(kind)) throw new TypeError("Form decoder field '" + name + "' uses an unsupported decoder");
  if (typeof value.optional !== "boolean") throw new TypeError("Form decoder optional must be bool");
  let enumValues = null;
  if (kind === "enum") {
    enumValues = __velarRequireList(value.enumValues, "Form enum values");
    if (enumValues.length > maxFormFields) throw new RangeError("Form enum values cannot exceed 100000 entries");
    if (!enumValues.every((item) => typeof item === "string")) throw new TypeError("Form enum values must be strings");
  } else if (value.enumValues != null) {
    throw new TypeError("Only enum form decoders can declare enum values");
  }
  return Object.freeze({ name, kind, optional: value.optional, enumValues });
}

export function values(form) {
  requireForm(form);
  const output = new Map();
  let count = 0;
  for (const [name, value] of new FormData(form)) {
    count += 1;
    if (count > maxFormFields) throw new RangeError("Forms cannot exceed 100000 submitted fields");
    const checkedName = formText(name, "Submitted form field name");
    formValue(value, "Form field '" + checkedName + "'");
    if (!output.has(checkedName)) output.set(checkedName, value);
    else {
      const current = output.get(checkedName);
      if (Array.isArray(current)) current.push(value);
      else output.set(checkedName, [current, value]);
    }
  }
  return output;
}

export function read(form, type, fields) {
  requireForm(form);
  type = formType(type);
  const decoderItems = __velarRequireList(fields, "Form decoder fields");
  if (decoderItems.length > maxFormFields) throw new RangeError("Form decoders cannot exceed 100000 fields");
  fields = decoderItems.map(decoderField);
  const data = new FormData(form);
  const output = Object.create(null);
  for (const field of fields) {
    const name = field.name;
    const value = formValue(data.get(name), "Form field '" + name + "'");
    if (field.kind === "string") {
      if (value == null) output[name] = field.optional ? null : "";
      else if (typeof value === "string") output[name] = value;
      else throw new TypeError("Form field '" + name + "' is not textual");
    } else if (field.kind === "number") {
      if (value == null || (typeof value === "string" && value.trim() === "")) {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a finite number");
      } else {
        const number = formNumber(value);
        if (number === null) throw new TypeError("Form field '" + name + "' requires a finite decimal number");
        output[name] = number;
      }
    } else if (field.kind === "bool") {
      output[name] = data.has(name);
    } else if (field.kind === "enum") {
      if (value == null || value === "") {
        if (field.optional) output[name] = null;
        else throw new TypeError("Form field '" + name + "' requires a known enum value");
      } else if (typeof value === "string") {
        if (!field.enumValues.includes(value)) throw new TypeError("Form field '" + name + "' requires a known enum value");
        output[name] = value;
      } else {
        throw new TypeError("Form field '" + name + "' requires a known enum value");
      }
    } else if (field.kind === "strings") {
      output[name] = formList(data.getAll(name), "Form field '" + name + "'").map((item) => {
        formValue(item, "Form field '" + name + "'");
        if (typeof item !== "string") throw new TypeError("Form field '" + name + "' is not textual");
        return item;
      });
    } else {
      throw new TypeError("Form field '" + name + "' uses an unsupported decoder");
    }
  }
  return type.parse(output);
}

export function fieldValue(form, name) {
  return firstValue(form, name);
}

export function textValue(form, name, fallback = "") {
  name = formText(name, "Form field name");
  fallback = formText(fallback, "Form text fallback", maxFormTextCodeUnits);
  const value = firstValue(form, name);
  if (value == null) return fallback;
  if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
  return value;
}

export function numberValue(form, name) {
  return formNumber(textValue(form, name));
}

export function checkedValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return new FormData(form).has(name);
}

export function fieldValues(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return formList(new FormData(form).getAll(name), "Form field '" + name + "'").map((value) => {
    formValue(value, "Form field '" + name + "'");
    if (typeof value !== "string") throw new TypeError("Form field '" + name + "' is not textual");
    return value;
  });
}

export function setError(form, name, message) {
  requireForm(form);
  name = formText(name, "Form field name");
  message = formText(message, "Form error message", 65536);
  const field = namedField(form, name);
  if (!field) throw new Error("Form field '" + name + "' was not found");
  let error = Array.from(formErrorNodes(form)).find((item) => item.getAttribute("data-velar-field-error") === name);
  if (!error) {
    error = document.createElement("p");
    error.id = "velar-field-error-" + nextErrorId++;
    error.setAttribute("data-velar-field-error", name);
    error.setAttribute("role", "alert");
    field.insertAdjacentElement("afterend", error);
  }
  error.textContent = message;
  field.setAttribute("aria-invalid", "true");
  const describedText = formText(field.getAttribute("aria-describedby") ?? "", "Form aria-describedby", 65536);
  const described = new Set(describedText.split(/\s+/u).filter(Boolean));
  described.add(error.id);
  field.setAttribute("aria-describedby", [...described].join(" "));
  return null;
}

export function clearError(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  const field = namedField(form, name);
  const error = Array.from(formErrorNodes(form)).find((item) => item.getAttribute("data-velar-field-error") === name);
  if (error) error.remove();
  if (field) {
    field.removeAttribute("aria-invalid");
    const describedText = formText(field.getAttribute("aria-describedby") ?? "", "Form aria-describedby", 65536);
    const described = describedText.split(/\s+/u).filter((id) => id && id !== error?.id);
    if (described.length) field.setAttribute("aria-describedby", described.join(" "));
    else field.removeAttribute("aria-describedby");
  }
  return null;
}

export function clearErrors(form) {
  requireForm(form);
  for (const name of [...errors(form).keys()]) clearError(form, name);
  return null;
}

export function errors(form) {
  requireForm(form);
  const nodes = formErrorNodes(form);
  const output = new Map();
  for (const item of nodes) {
    const name = formText(item.getAttribute("data-velar-field-error") ?? "", "Form error field name");
    const message = formText(item.textContent ?? "", "Form error message", 65536);
    if (name) output.set(name, message);
  }
  return output;
}

export function focusFirstError(form) {
  requireForm(form);
  const error = form.querySelector("[data-velar-field-error]");
  const field = error ? namedField(form, formText(error.getAttribute("data-velar-field-error") ?? "", "Form error field name")) : null;
  if (!field) return false;
  field.focus();
  return true;
}

export function setPending(form, pending) {
  requireForm(form);
  if (typeof pending !== "boolean") throw new TypeError("setPending requires a boolean");
  if (pending) {
    const elements = formElements(form);
    const snapshot = [];
    for (let index = 0; index < elements.length; index += 1) {
      const field = elements[index];
      if (!field || typeof field !== "object" || typeof field.disabled !== "boolean") throw new TypeError("Form controls must expose a bool disabled state");
      snapshot.push([field, field.disabled]);
    }
    if (!pendingFields.has(form)) pendingFields.set(form, snapshot);
    form.setAttribute("aria-busy", "true");
    for (const [field] of snapshot) field.disabled = true;
  } else {
    form.removeAttribute("aria-busy");
    for (const [field, disabled] of pendingFields.get(form) ?? []) field.disabled = disabled;
    pendingFields.delete(form);
  }
  return null;
}

export function reset(form) {
  requireForm(form);
  if (pendingFields.has(form)) setPending(form, false);
  clearErrors(form);
  form.reset();
  return null;
}

function namedField(form, name) {
  for (const item of formElements(form)) if (item.name === name) return item;
  return null;
}

function firstValue(form, name) {
  requireForm(form);
  name = formText(name, "Form field name");
  return formValue(new FormData(form).get(name), "Form field '" + name + "'");
}

function requireForm(value) {
  if (!(value instanceof HTMLFormElement)) throw new TypeError("VelarScript form helpers require a form element");
}
`.trimStart()],
  ["velar/http", String.raw`
${listRuntime}
${optionsRuntime}
${VELAR_STRICT_JSON_RUNTIME}
${runtimeTypeRuntime}
${fileRegistryRuntime}
const formBodies = new WeakMap();

function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }

function methodOf(value) {
  const method = __velarString(value, "HTTP method").toUpperCase();
  if (method.length > 32) throw new RangeError("HTTP methods cannot exceed 32 characters");
  if (!/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) throw new TypeError("HTTP method is invalid or forbidden by Fetch");
  return method;
}

function headersOf(value) {
  if (value == null) return new Map();
  try { Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  const headers = new Map();
  let units = 0;
  for (const [name, item] of Map.prototype.entries.call(value)) {
    if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP header names and values must be strings");
    units += name.length + item.length;
    if (headers.size >= 100 || units > 65536) throw new RangeError("HTTP headers cannot exceed 100 fields or 64 KiB");
    headers.set(name, item);
  }
  return headers;
}

function responseHeadersOf(value) {
  if (typeof Headers === "undefined" || !(value instanceof Headers)) throw new TypeError("HTTP responses require native Headers");
  const headers = new Map();
  let units = 0;
  for (const [name, item] of Headers.prototype.entries.call(value)) {
    if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP response header names and values must be strings");
    units += name.length + item.length;
    if ((!headers.has(name) && headers.size >= 100) || units > 65536) throw new RangeError("HTTP response headers cannot exceed 100 fields or 64 KiB");
    headers.set(name, item);
  }
  return headers;
}

function optionsOf(value) {
  value = __velarOptions(value, "HTTP options", new Set(["headers", "body", "timeout", "maxBytes", "credentials", "cache"]));
  const timeout = value.timeout ?? 0;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) throw new RangeError("HTTP timeout must be milliseconds from 0 through 2147483647");
  const maxBytes = value.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const credentials = value.credentials == null ? undefined : __velarString(value.credentials, "HTTP credentials");
  if (credentials !== undefined && !["omit", "same-origin", "include"].includes(credentials)) throw new TypeError("HTTP credentials must be omit, same-origin, or include");
  const cache = value.cache == null ? undefined : __velarString(value.cache, "HTTP cache mode");
  if (cache !== undefined && !["default", "no-store", "reload", "no-cache", "force-cache"].includes(cache)) throw new TypeError("HTTP cache mode must be default, no-store, reload, no-cache, or force-cache");
  const body = value.body ?? null;
  const multipart = body && typeof body === "object" ? formBodies.get(body) : null;
  const nativeForm = typeof FormData !== "undefined" && body instanceof FormData;
  const nativeBlob = typeof Blob !== "undefined" && body instanceof Blob;
  if (body != null && typeof body !== "string" && !multipart && !nativeForm && !nativeBlob) {
    if (typeof body !== "object") throw new TypeError("HTTP body must be text, JSON data, a Blob, or a VelarScript form body");
    __velarAssertJson(body);
  }
  if (typeof body === "string" && body.length > 16 * 1024 * 1024) throw new RangeError("HTTP text bodies cannot exceed 16 MiB");
  return Object.freeze({ headers: headersOf(value.headers), body, timeout, maxBytes, credentials, cache });
}

function fieldName(value) {
  const name = __velarString(value, "Form body field name");
  if (!name) throw new TypeError("Form body field names cannot be empty");
  if (name.length > 1024) throw new RangeError("Form body field names cannot exceed 1024 characters");
  return name;
}

function nativeFile(value) {
  return __velarNativeFile(value, "Form body files must come from velar/files pick()");
}

export function formBody() {
  const data = new FormData();
  let fieldCount = 0;
  const reserve = (count = 1) => { if (fieldCount + count > 100000) throw new RangeError("Form bodies cannot exceed 100000 fields"); fieldCount += count; };
  const fieldValue = (value) => { value = __velarString(value, "Form body field value"); if (value.length > 16 * 1024 * 1024) throw new RangeError("Form body field values cannot exceed 16 MiB"); return value; };
  const body = {
    field(name, value) { name = fieldName(name); value = fieldValue(value); reserve(); data.append(name, value); return null; },
    file(name, value, fileName = "") {
      const file = nativeFile(value);
      fileName = __velarString(fileName, "Form body file name");
      if (fileName.length > 4096) throw new RangeError("Form body file names cannot exceed 4096 characters");
      name = fieldName(name);
      reserve();
      if (fileName) data.append(name, file, fileName);
      else data.append(name, file);
      return null;
    },
    files(name, values) {
      name = fieldName(name);
      const input = __velarRequireList(values, "Form body files");
      const files = new Array(input.length);
      for (let index = 0; index < input.length; index += 1) files[index] = nativeFile(input[index]);
      reserve(files.length);
      for (const file of files) data.append(name, file);
      return null;
    },
    remove(name) { name = fieldName(name); fieldCount -= data.getAll(name).length; data.delete(name); return null; },
    has(name) { return data.has(fieldName(name)); },
    names() { return [...new Set(data.keys())]; },
  };
  formBodies.set(body, data);
  return Object.freeze(body);
}

export class HttpError extends Error {
  constructor(message, status, url, body = null) {
    message = __velarString(message, "HTTP error message");
    url = __velarString(url, "HTTP error URL");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError";
    this.reason = reason;
  }
}

class HttpResponse {
  constructor(response, maxBytes) {
    if (typeof response.ok !== "boolean" || !Number.isInteger(response.status) || (response.status !== 0 && (response.status < 100 || response.status > 599))) {
      throw new TypeError("Fetch returned invalid HTTP response metadata");
    }
    const statusText = __velarString(response.statusText, "HTTP response status text");
    const url = __velarString(response.url, "HTTP response URL");
    if (statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
    this.native = response;
    this.maxBytes = maxBytes;
    this.bytesValue = null;
    this.bytesPending = null;
    this.ok = response.ok;
    this.status = response.status;
    this.statusText = statusText;
    this.url = url;
    this.headers = responseHeadersOf(response.headers);
  }
  async bytes() {
    if (this.bytesValue) return this.bytesValue;
    if (this.bytesPending) return this.bytesPending;
    const declared = this.native.headers.get("content-length");
    if (declared && /^\d+$/u.test(declared) && Number(declared) > this.maxBytes) {
      await this.native.body?.cancel("VelarScript HTTP response exceeded maxBytes");
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    this.bytesPending = (async () => {
      const reader = this.native.body?.getReader();
      if (!reader) return new Uint8Array();
      const chunks = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > this.maxBytes) {
          await reader.cancel("VelarScript HTTP response exceeded maxBytes");
          throw new RangeError("HTTP response exceeds maxBytes");
        }
        chunks.push(next.value);
      }
      const output = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
      return output;
    })();
    try { this.bytesValue = await this.bytesPending; return this.bytesValue; }
    finally { this.bytesPending = null; }
  }
  async json() { const text = await this.text(); if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("JSON text cannot exceed 16 MiB"); const value = JSON.parse(text); __velarAssertJson(value); return value; }
  async text() { return new TextDecoder().decode(await this.bytes()); }
  async blob() { return new Blob([await this.bytes()], { type: this.native.headers.get("content-type") ?? "" }); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}

class Request {
  constructor(method, url, options) {
    this.method = methodOf(method);
    this.url = __velarString(url, "HTTP URL");
    if (this.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP URLs cannot exceed 2 MiB");
    this.options = optionsOf(options);
    if ((this.method === "GET" || this.method === "HEAD") && this.options.body != null) throw new TypeError(this.method + " requests cannot have a body");
    this.controller = null;
    this.pending = null;
    this.abortError = null;
    this.finished = false;
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    this.controller = new AbortController();
    this.pending = this.perform(this.controller);
    return this.pending;
  }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.controller) this.controller.abort(this.abortError);
  }
  async perform(controller) {
    const timeoutMs = this.options.timeout ?? 0;
    let timer = null;
    try {
      timer = timeoutMs ? setTimeout(() => this.abort("timeout"), timeoutMs) : null;
      const headers = new Headers([...this.options.headers]);
      let body = this.options.body;
      const multipart = body != null && typeof body === "object" ? formBodies.get(body) : null;
      if (multipart instanceof FormData) {
        if (headers.has("content-type")) throw new TypeError("Do not set content-type for a VelarScript form body; the browser owns its multipart boundary");
        body = multipart;
      } else if (body != null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
        body = __velarJsonStringify(body);
      }
      const response = await fetch(this.url, {
        method: this.method,
        headers,
        body,
        credentials: this.options.credentials,
        cache: this.options.cache,
        signal: controller.signal,
      });
      if (this.abortError) throw this.abortError;
      const wrapped = new HttpResponse(response, this.options.maxBytes);
      if (!response.ok) {
        const text = await wrapped.text();
        let parsed = text;
        try { if (text.length > __velarMaxJsonCodeUnits) throw new RangeError("Error body is too large for JSON"); parsed = text ? JSON.parse(text) : null; __velarAssertJson(parsed); } catch { parsed = text; }
        throw new HttpError("HTTP " + response.status + " for " + this.url, response.status, this.url, parsed);
      }
      return wrapped;
    } catch (error) {
      if (this.abortError) throw this.abortError;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      this.finished = true;
    }
  }
  async json() { return (await this.response()).json(); }
  async text() { return (await this.response()).text(); }
  async blob() { return (await this.response()).blob(); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}

const createRequest = (method) => (url, options = {}) => new Request(method, url, options);
export const http = Object.freeze({
  request(method, url, options = {}) { return new Request(method, url, options); },
  get: createRequest("GET"), post: createRequest("POST"), put: createRequest("PUT"), patch: createRequest("PATCH"), delete: createRequest("DELETE"), head: createRequest("HEAD"),
});
`.trimStart()],
  ["velar/storage", String.raw`
${ownedCallbackRuntime}
${VELAR_STRICT_JSON_RUNTIME}
${listRuntime}
${runtimeTypeRuntime}
const changeEvent = "velar-storage-change";
const storageMaxKeyCodeUnits = 4096;
const storageMaxListingCodeUnits = 16 * 1024 * 1024;
const storageStringSlice = Object.getOwnPropertyDescriptor(String.prototype, "slice").value;
const storageListSort = Object.getOwnPropertyDescriptor(Array.prototype, "sort").value;

function storageType(Type) { return __velarRequireRuntimeType(Type, "Storage reads"); }
function storageText(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); if (value.length > storageMaxKeyCodeUnits) throw new RangeError(name + " cannot exceed 4096 characters"); return value; }
function parsed(raw, Type, fallback) {
  Type = storageType(Type);
  if (raw == null) return fallback;
  try { if (typeof raw !== "string" || raw.length > __velarMaxJsonCodeUnits) return fallback; const value = JSON.parse(raw); __velarAssertJson(value); return Type.parse(value); } catch { return fallback; }
}

function createStore(storageName, prefix = "", areaName = "local") {
  const area = () => {
    const value = globalThis[storageName];
    if (!value) throw new Error("velar/storage requires a browser storage environment");
    return value;
  };
  const full = (key) => {
    const value = storageText(key, "Storage key");
    if (prefix.length > storageMaxKeyCodeUnits - value.length) throw new RangeError("Scoped storage keys cannot exceed 4096 characters");
    return prefix + value;
  };
  const emit = (key, oldValue, newValue) => dispatchEvent(new CustomEvent(changeEvent, { detail: { areaName, key, oldValue, newValue } }));
  const api = {
    get(key, Type, fallback = null) {
      Type = storageType(Type);
      const name = full(key);
      return parsed(area().getItem(name), Type, fallback);
    },
    set(key, value) {
      const name = full(key);
      const next = __velarJsonStringify(value);
      const target = area();
      const previous = target.getItem(name);
      target.setItem(name, next);
      emit(name, previous, next);
      return null;
    },
    has(key) { const name = full(key); return area().getItem(name) != null; },
    keys() {
      const target = area();
      const count = target.length;
      if (!Number.isSafeInteger(count) || count < 0 || count > 100000) throw new RangeError("Browser storage cannot exceed 100000 keys");
      const output = [];
      let outputUnits = 0;
      for (let index = 0; index < count; index += 1) {
        const key = target.key(index);
        if (key === null) continue;
        if (typeof key !== "string") throw new TypeError("Browser storage returned a non-string key");
        if (key.length < prefix.length || storageStringSlice.call(key, 0, prefix.length) !== prefix) continue;
        if (key.length > storageMaxKeyCodeUnits) throw new RangeError("Browser storage keys cannot exceed 4096 characters");
        const visible = storageStringSlice.call(key, prefix.length);
        outputUnits += visible.length;
        if (outputUnits > storageMaxListingCodeUnits) throw new RangeError("Browser storage key listings cannot exceed 16 MiB");
        output.push(visible);
      }
      storageListSort.call(output);
      return output;
    },
    remove(key) {
      const name = full(key);
      const target = area();
      const previous = target.getItem(name);
      target.removeItem(name);
      if (previous != null) emit(name, previous, null);
      return null;
    },
    clear() { for (const key of api.keys()) api.remove(key); return null; },
    scope(name) {
      const value = storageText(name, "Storage scope").trim();
      if (!value) throw new TypeError("Storage scope cannot be empty");
      if (prefix.length > storageMaxKeyCodeUnits - value.length - 1) throw new RangeError("Storage scope paths cannot exceed 4096 characters");
      return createStore(storageName, prefix + value + ":", areaName);
    },
    watch(key, Type, callback) {
      if (typeof callback !== "function") throw new TypeError("Storage watch requires a callback");
      Type = storageType(Type);
      const name = full(key);
      const changed = (event) => {
        const detail = event.detail;
        if (!detail || detail.areaName !== areaName || detail.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(detail.newValue, Type, null), parsed(detail.oldValue, Type, null)], "storage", "watch");
      };
      const stored = (event) => {
        if (event.storageArea !== area() || event.key !== name) return;
        __velarInvokeOwnedCallback(callback, [parsed(event.newValue, Type, null), parsed(event.oldValue, Type, null)], "storage", "watch");
      };
      addEventListener(changeEvent, changed);
      addEventListener("storage", stored);
      return () => { removeEventListener(changeEvent, changed); removeEventListener("storage", stored); return null; };
    },
  };
  return Object.freeze(api);
}

export const storage = createStore("localStorage");
export const session = createStore("sessionStorage", "", "session");

export function database(name) {
  const databaseName = storageText(name, "Database name").trim();
  if (!databaseName) throw new TypeError("Database name cannot be empty");
  if (databaseName.length > 256) throw new RangeError("Database names cannot exceed 256 characters");
  let opened = null;
  const connect = () => {
    if (opened) return opened;
    const pending = new Promise((resolve, reject) => {
      const request = indexedDB.open("velar:" + databaseName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("values")) request.result.createObjectStore("values"); };
      request.onsuccess = () => {
        const result = request.result;
        if (opened !== pending) { result.close(); return; }
        result.onversionchange = () => { result.close(); if (opened === pending) opened = null; };
        resolve(result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("VelarScript database upgrade is blocked by another open page"));
    });
    opened = pending;
    void pending.catch(() => { if (opened === pending) opened = null; });
    return pending;
  };
  const request = async (mode, operation) => {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("values", mode);
      const result = operation(transaction.objectStore("values"));
      let value;
      result.onsuccess = () => { value = result.result; };
      result.onerror = () => reject(result.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve(value);
    });
  };
  const keyOf = (key) => storageText(key, "Database key");
  return Object.freeze({
    async get(key, Type, fallback = null) { Type = storageType(Type); const name = keyOf(key); const value = await request("readonly", (store) => store.get(name)); return value === undefined ? fallback : (() => { try { return Type.parse(value); } catch { return fallback; } })(); },
    async set(key, value) {
      const name = keyOf(key);
      const encoded = __velarJsonStringify(value);
      await request("readwrite", (store) => store.put(JSON.parse(encoded), name));
      return null;
    },
    async has(key) { const name = keyOf(key); return (await request("readonly", (store) => store.getKey(name))) !== undefined; },
    async keys() {
      let keys = await request("readonly", (store) => store.getAllKeys(undefined, 100001));
      if (!Array.isArray(keys)) throw new TypeError("VelarScript database keys must be a List");
      if (keys.length > 100000) throw new RangeError("VelarScript databases cannot expose more than 100000 keys at once");
      keys = __velarRequireList(keys, "Database keys");
      for (const key of keys) if (typeof key !== "string") throw new TypeError("VelarScript database contains a non-string key");
      return keys.sort();
    },
    async remove(key) { const name = keyOf(key); await request("readwrite", (store) => store.delete(name)); return null; },
    async clear() { await request("readwrite", (store) => store.clear()); return null; },
  });
}
`.trimStart()],
  ["velar/browser", String.raw`
${ownedCallbackRuntime}
${optionsRuntime}
const timerRuntimeKey = Symbol.for("velar.runtime.v1");

function browserNumber(value, name) { if (!Number.isFinite(value)) throw new TypeError(name + " must be a finite number"); return value; }
function browserBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
function browserText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function browserQuery(search) {
  search = browserText(search, "Browser location query", 2 * 1024 * 1024);
  const output = new Map();
  let count = 0;
  for (const [name, value] of new URLSearchParams(search)) {
    count += 1;
    if (count > 100000) throw new RangeError("Browser location queries cannot exceed 100000 fields");
    output.set(name, value);
  }
  return output;
}
function browserLanguages(value) {
  if (!Array.isArray(value) || value.length > 1000 || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) throw new TypeError("Browser languages must be a dense List");
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Browser languages cannot use accessors");
    output[index] = browserText(descriptor.value, "Browser language", 256);
  }
  return output;
}
function scrollBehavior(value) { value = __velarString(value, "Scroll behavior"); if (!["auto", "smooth", "instant"].includes(value)) throw new TypeError("Scroll behavior must be auto, smooth, or instant"); return value; }

function timerDuration(value, name, positive) {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647 || (positive && value === 0)) {
    throw new RangeError(name + (positive ? " requires milliseconds from above 0 through 2147483647" : " requires milliseconds from 0 through 2147483647"));
  }
  return value;
}

function reportTimerFailure(failure, detail) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[timerRuntimeKey];
  if (runtime && typeof runtime.report === "function") {
    runtime.report(error, { phase: "timer", detail, unhandled: true });
  } else {
    queueMicrotask(() => { throw error; });
  }
}

async function invokeTimer(callback, detail) {
  try {
    const observed = __velarObserveOwnedPromise(
      callback(),
      (failure) => __velarReportOwnedCallback(failure, "timer", detail),
    );
    if (observed) await observed;
  }
  catch (error) { reportTimerFailure(error, detail); }
}

export function after(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "after", false);
  if (typeof callback !== "function") throw new TypeError("after requires a callback");
  let active = true;
  const timer = setTimeout(() => {
    if (!active) return;
    active = false;
    void invokeTimer(callback, "after");
  }, duration);
  return () => { active = false; clearTimeout(timer); return null; };
}

export function every(milliseconds, callback) {
  const duration = timerDuration(milliseconds, "every", true);
  if (typeof callback !== "function") throw new TypeError("every requires a callback");
  let active = true;
  let timer = null;
  const schedule = () => {
    if (!active) return;
    timer = setTimeout(async () => {
      if (!active) return;
      await invokeTimer(callback, "every");
      schedule();
    }, duration);
  };
  schedule();
  return () => { active = false; if (timer !== null) clearTimeout(timer); return null; };
}

export function location() {
  const value = globalThis.location;
  return Object.freeze({
    href: browserText(value.href, "Browser location URL", 2 * 1024 * 1024),
    origin: browserText(value.origin, "Browser location origin", 2 * 1024 * 1024),
    path: browserText(value.pathname, "Browser location path", 2 * 1024 * 1024),
    query: browserQuery(value.search),
    hash: browserText(value.hash, "Browser location hash", 2 * 1024 * 1024),
  });
}

export function environment() {
  const language = browserText(navigator.language, "Browser language", 256);
  const languages = browserLanguages(navigator.languages);
  if (typeof navigator.onLine !== "boolean") throw new TypeError("Browser online state must be bool");
  if (document.visibilityState !== "visible" && document.visibilityState !== "hidden") throw new TypeError("Browser visibility state is invalid");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof dark !== "boolean" || typeof reduced !== "boolean") throw new TypeError("Browser media preferences must be bool");
  if (!Number.isSafeInteger(navigator.maxTouchPoints) || navigator.maxTouchPoints < 0 || navigator.maxTouchPoints > 1000) throw new RangeError("Browser touch points are outside VelarScript limits");
  return Object.freeze({
    language,
    languages,
    online: navigator.onLine,
    visible: document.visibilityState === "visible",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reduced,
    touch: navigator.maxTouchPoints > 0,
  });
}

function clipboard() {
  if (!globalThis.isSecureContext || !navigator.clipboard) throw new Error("Clipboard access requires a secure browser context");
  return navigator.clipboard;
}

export async function copyText(value) { value = browserText(value, "Clipboard text", 16 * 1024 * 1024); await clipboard().writeText(value); return null; }
export async function readClipboardText() { return browserText(await clipboard().readText(), "Clipboard text", 16 * 1024 * 1024); }
export function open(url, target = "_blank") { url = browserText(url, "Browser URL", 2 * 1024 * 1024); target = browserText(target, "Browser target", 256); globalThis.open(url, target, target === "_blank" ? "noopener,noreferrer" : undefined); return null; }
export function scrollTo(x, y, behavior = "auto") { globalThis.scrollTo({ left: browserNumber(x, "Scroll x"), top: browserNumber(y, "Scroll y"), behavior: scrollBehavior(behavior) }); return null; }
export function scrollIntoView(element, behavior = "smooth") { requireElement(element); element.scrollIntoView({ behavior: scrollBehavior(behavior), block: "nearest" }); return null; }
export function focus(element, preventScroll = false) {
  element = requireFocusableElement(element);
  preventScroll = __velarBool(preventScroll, "Focus preventScroll");
  HTMLElement.prototype.focus.call(element, { preventScroll });
  return null;
}
export function blur(element) {
  element = requireFocusableElement(element);
  HTMLElement.prototype.blur.call(element);
  return null;
}
export function measure(element) {
  requireElement(element);
  const value = element.getBoundingClientRect();
  return Object.freeze({
    x: browserNumber(value.x, "Element x"), y: browserNumber(value.y, "Element y"),
    width: browserNumber(value.width, "Element width"), height: browserNumber(value.height, "Element height"),
    top: browserNumber(value.top, "Element top"), right: browserNumber(value.right, "Element right"),
    bottom: browserNumber(value.bottom, "Element bottom"), left: browserNumber(value.left, "Element left"),
  });
}
export function media(query) { return browserBool(matchMedia(browserText(query, "Media query", 4096)).matches, "Media query result"); }
export function watchMedia(query, callback) {
  if (typeof callback !== "function") throw new TypeError("watchMedia requires a callback");
  const matcher = matchMedia(browserText(query, "Media query", 4096));
  const changed = (event) => __velarInvokeOwnedRead(() => browserBool(event.matches, "Media watcher result"), callback, "observer", "media");
  matcher.addEventListener("change", changed);
  return () => { matcher.removeEventListener("change", changed); return null; };
}
export function watchOnline(callback) {
  if (typeof callback !== "function") throw new TypeError("watchOnline requires a callback");
  const changed = () => __velarInvokeOwnedRead(() => browserBool(navigator.onLine, "Browser online state"), callback, "observer", "online");
  addEventListener("online", changed); addEventListener("offline", changed);
  return () => { removeEventListener("online", changed); removeEventListener("offline", changed); return null; };
}
export function watchVisibility(callback) {
  if (typeof callback !== "function") throw new TypeError("watchVisibility requires a callback");
  const changed = () => __velarInvokeOwnedRead(() => {
    if (document.visibilityState !== "visible" && document.visibilityState !== "hidden") throw new TypeError("Browser visibility state is invalid");
    return document.visibilityState === "visible";
  }, callback, "observer", "visibility");
  document.addEventListener("visibilitychange", changed);
  return () => { document.removeEventListener("visibilitychange", changed); return null; };
}
export function showDialog(dialog) {
  requireDialog(dialog);
  if (!dialog.isConnected) throw new Error("A dialog must be mounted before it can be shown");
  if (!dialog.open) dialog.showModal();
  return null;
}
export function closeDialog(dialog, result = "") {
  requireDialog(dialog);
  result = browserText(result, "Dialog result", 65536);
  if (dialog.open) dialog.close(result);
  return null;
}
export function dialogResult(dialog) { requireDialog(dialog); return browserText(dialog.returnValue, "Dialog result", 65536); }
export function frame() { return new Promise((resolve, reject) => requestAnimationFrame((value) => { try { resolve(browserNumber(value, "Animation frame timestamp")); } catch (error) { reject(error); } })); }
function requireElement(value) { if (!(value instanceof Element)) throw new TypeError("Browser element helpers require an Element"); }
function requireFocusableElement(value) {
  requireElement(value);
  if (typeof HTMLElement === "undefined" || !(value instanceof HTMLElement)) throw new TypeError("Focus helpers require an HTML element");
  return value;
}
function requireDialog(value) { if (typeof HTMLDialogElement === "undefined" || !(value instanceof HTMLDialogElement)) throw new TypeError("Dialog helpers require a <dialog> element"); }
`.trimStart()],
  ["velar/files", String.raw`
${optionsRuntime}
${fileRegistryRuntime}
const defaultFileReadBytes = 16 * 1024 * 1024;
const maxFileReadBytes = 64 * 1024 * 1024;
const nativeFileListLength = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "length")?.get : null;
const nativeFileListItem = typeof FileList === "function" ? Object.getOwnPropertyDescriptor(FileList.prototype, "item")?.value : null;
function readLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileReadBytes) throw new RangeError("File maxBytes must be an integer from 1 through 67108864");
  return value;
}
function fileText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function nativePickerField(operation, files, index = null) {
  if (typeof operation !== "function") throw new TypeError("The browser does not expose the required native FileList API");
  try { return index === null ? operation.call(files) : operation.call(files, index); }
  catch { throw new TypeError("A file picker returned an invalid native FileList"); }
}
function wrap(file) {
  const name = fileText(__velarReadNativeFileField(__velarNativeFileName, file), "Selected file name", 4096);
  const type = fileText(__velarReadNativeFileField(__velarNativeBlobType, file), "Selected file MIME type", 1024);
  const size = __velarReadNativeFileField(__velarNativeBlobSize, file);
  const modified = __velarReadNativeFileField(__velarNativeFileModified, file);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Selected file size must be a non-negative safe integer");
  if (!Number.isFinite(modified) || modified < 0) throw new TypeError("Selected file modified time must be a non-negative finite number");
  const value = { name, size, type, modified };
  Object.freeze(value);
  WeakMap.prototype.set.call(nativeFiles, value, file);
  return value;
}
function native(file) { return __velarNativeFile(file, "Expected a file returned by velar/files"); }
export function pick(options = {}) {
  options = __velarOptions(options, "File picker options", new Set(["accept", "multiple"]));
  const accept = options.accept == null ? "" : __velarString(options.accept, "File accept filter");
  if (accept.length > 4096) throw new RangeError("File accept filters cannot exceed 4096 characters");
  const multiple = options.multiple == null ? false : __velarBool(options.multiple, "File picker multiple");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    document.body.append(input);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      globalThis.removeEventListener("focus", focused);
      try {
        const selected = input.files;
        if (!selected || typeof selected !== "object") throw new TypeError("A file picker returned an invalid file list");
        const count = nativePickerField(nativeFileListLength, selected);
        if (!Number.isSafeInteger(count) || count < 0) throw new TypeError("A file picker returned an invalid file list length");
        if (count > 10000) {
          input.remove();
          reject(new RangeError("A file picker cannot return more than 10000 files"));
          return;
        }
        const files = [];
        for (let index = 0; index < count; index += 1) {
          const file = nativePickerField(nativeFileListItem, selected, index);
          if (file === null) throw new TypeError("A file picker returned an incomplete native FileList");
          files.push(wrap(file));
        }
        input.remove();
        resolve(files);
      } catch (error) {
        input.remove();
        reject(error);
      }
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    const focused = () => setTimeout(finish, 0);
    globalThis.addEventListener("focus", focused, { once: true });
    input.click();
  });
}
export function readText(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  if (typeof __velarNativeBlobText !== "function") throw new TypeError("The browser does not expose native Blob text reading");
  return Promise.resolve(__velarNativeBlobText.call(value)).then((result) => {
    if (typeof result !== "string") throw new TypeError("File text result was not a string");
    if (result.length > maxBytes) throw new RangeError("File text result exceeds maxBytes");
    return result;
  });
}
export function readDataUrl(file, maxBytes = defaultFileReadBytes) {
  const value = native(file);
  maxBytes = readLimit(maxBytes);
  if (__velarReadNativeFileField(__velarNativeBlobSize, value) > maxBytes) throw new RangeError("File exceeds maxBytes");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") { reject(new TypeError("File data URL result was not text")); return; }
      if (reader.result.length > Math.ceil(maxBytes * 4 / 3) + 4096) { reject(new RangeError("File data URL result exceeds maxBytes expansion")); return; }
      resolve(reader.result);
    };
    reader.onerror = () => reject(Error.isError(reader.error) ? reader.error : new Error("File reading failed"));
    reader.readAsDataURL(value);
  });
}
export function download(name, data, mime = "text/plain;charset=utf-8") {
  name = __velarString(name, "Download name");
  data = __velarString(data, "Download data");
  mime = __velarString(mime, "Download MIME type");
  if (!name || name.length > 4096) throw new RangeError("Download names must contain 1 through 4096 characters");
  if (data.length > maxFileReadBytes) throw new RangeError("Download text cannot exceed 64 MiB");
  if (!mime || mime.length > 1024) throw new RangeError("Download MIME types must contain 1 through 1024 characters");
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}
`.trimStart()],
  ["velar/realtime", String.raw`
${ownedCallbackRuntime}
${optionsRuntime}
${VELAR_STRICT_JSON_RUNTIME}
const maxRealtimeTextCodeUnits = 16 * 1024 * 1024;
const maxRealtimeUrlCodeUnits = 2 * 1024 * 1024;
function realtimeUrl(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeUrlCodeUnits) throw new RangeError(name + " cannot exceed 2 MiB");
  return value;
}
function realtimeMessage(value, name) {
  value = __velarString(value, name);
  if (value.length > maxRealtimeTextCodeUnits) throw new RangeError(name + " cannot exceed 16 MiB");
  return value;
}
function handler(value, allowed) {
  value = __velarOptions(value, "Realtime handlers", allowed);
  for (const name of Object.getOwnPropertyNames(value)) {
    const callback = Object.getOwnPropertyDescriptor(value, name).value;
    if (callback != null && typeof callback !== "function") throw new TypeError("Realtime handler '" + name + "' must be callable");
  }
  return value;
}
function webSocketState(value) {
  if (value.readyState === 0) return "connecting";
  if (value.readyState === 1) return "open";
  if (value.readyState === 2) return "closing";
  if (value.readyState === 3) return "closed";
  throw new TypeError("WebSocket returned an invalid state");
}
function eventStreamState(value) {
  if (value.readyState === 0) return "connecting";
  if (value.readyState === 1) return "open";
  if (value.readyState === 2) return "closed";
  throw new TypeError("Event stream returned an invalid state");
}
export function socket(url, handlers = {}) {
  handlers = handler(handlers, new Set(["open", "message", "error", "close"]));
  const value = new WebSocket(realtimeUrl(url, "WebSocket URL"));
  let resolvedUrl;
  try { resolvedUrl = realtimeUrl(value.url, "WebSocket resolved URL"); }
  catch (failure) { try { value.close(); } catch {} throw failure; }
  value.addEventListener("open", () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "socket:open"));
  value.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      __velarInvokeOwnedCallback(handlers.error, ["Binary WebSocket messages are not supported by VelarScript Web API 0.10"], "realtime", "socket:error");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") value.close(1003, "Text messages only");
      return;
    }
    if (event.data.length > maxRealtimeTextCodeUnits) {
      __velarInvokeOwnedCallback(handlers.error, ["WebSocket message exceeded 16 MiB"], "realtime", "socket:error");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") value.close(1009, "Message too large");
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [event.data], "realtime", "socket:message");
  });
  value.addEventListener("error", () => __velarInvokeOwnedCallback(handlers.error, ["WebSocket connection error"], "realtime", "socket:error"));
  value.addEventListener("close", (event) => {
    try {
      if (!Number.isSafeInteger(event.code) || event.code < 0 || event.code > 65535) throw new TypeError("WebSocket close event returned an invalid code");
      const reason = realtimeMessage(event.reason, "WebSocket close event reason");
      if (new TextEncoder().encode(reason).length > 123) throw new RangeError("WebSocket close event reason cannot exceed 123 UTF-8 bytes");
      __velarInvokeOwnedCallback(handlers.close, [event.code, reason], "realtime", "socket:close");
    } catch (failure) { __velarReportOwnedCallback(failure, "realtime", "socket:close"); }
  });
  return Object.freeze({
    url: resolvedUrl,
    state: () => webSocketState(value),
    send(data) { data = realtimeMessage(data, "WebSocket message"); if (webSocketState(value) !== "open") throw new Error("WebSocket is not open"); value.send(data); return null; },
    sendJson(data) { if (webSocketState(value) !== "open") throw new Error("WebSocket is not open"); value.send(__velarJsonStringify(data)); return null; },
    close(code = 1000, reason = "") {
      if (!Number.isSafeInteger(code) || (code !== 1000 && (code < 3000 || code > 4999))) throw new RangeError("WebSocket close code must be 1000 or from 3000 through 4999");
      reason = __velarString(reason, "WebSocket close reason");
      if (new TextEncoder().encode(reason).length > 123) throw new RangeError("WebSocket close reason cannot exceed 123 UTF-8 bytes");
      const state = webSocketState(value);
      if (state === "connecting" || state === "open") value.close(code, reason);
      return null;
    },
  });
}
export function eventStream(url, handlers = {}, credentials = false) {
  handlers = handler(handlers, new Set(["open", "message", "error"]));
  credentials = __velarBool(credentials, "Event stream credentials");
  const value = new EventSource(realtimeUrl(url, "Event stream URL"), { withCredentials: credentials });
  let resolvedUrl;
  try { resolvedUrl = realtimeUrl(value.url, "Event stream resolved URL"); }
  catch (failure) { try { value.close(); } catch {} throw failure; }
  value.addEventListener("open", () => __velarInvokeOwnedCallback(handlers.open, [], "realtime", "event-stream:open"));
  value.addEventListener("message", (event) => {
    if (typeof event.data !== "string" || event.data.length > maxRealtimeTextCodeUnits || typeof event.lastEventId !== "string" || event.lastEventId.length > 65536) {
      __velarInvokeOwnedCallback(handlers.error, ["Event stream message or ID exceeded VelarScript limits"], "realtime", "event-stream:error");
      value.close();
      return;
    }
    __velarInvokeOwnedCallback(handlers.message, [event.data, event.lastEventId], "realtime", "event-stream:message");
  });
  value.addEventListener("error", () => __velarInvokeOwnedCallback(handlers.error, ["Event stream connection error"], "realtime", "event-stream:error"));
  return Object.freeze({
    url: resolvedUrl,
    state: () => eventStreamState(value),
    close() { value.close(); return null; },
  });
}
`.trimStart()],
  ["velar/web-test", String.raw`
const browserRuntimeKey = Symbol.for("velar.browser.test.v1");
function browserRuntime() {
  const runtime = globalThis[browserRuntimeKey];
  if (!runtime) throw new Error("velar/web-test browser controls require 'velar test --browser'");
  return runtime;
}
export const browser = Object.freeze({
  open(path = "/") { return browserRuntime().open(path); },
  reload() { return browserRuntime().reload(); },
  click(selector) { return browserRuntime().click(selector); },
  fill(selector, value) { return browserRuntime().fill(selector, value); },
  select(selector, value) { return browserRuntime().select(selector, value); },
  press(selector, key) { return browserRuntime().press(selector, key); },
  text(selector) { return browserRuntime().text(selector); },
  attribute(selector, name) { return browserRuntime().attribute(selector, name); },
  namespace(selector) { return browserRuntime().namespace(selector); },
  count(selector) { return browserRuntime().count(selector); },
  visible(selector) { return browserRuntime().visible(selector); },
  waitFor(selector, state = "visible") { return browserRuntime().waitFor(selector, state); },
  waitForText(selector, text) { return browserRuntime().waitForText(selector, text); },
  currentPath() { return browserRuntime().currentPath(); },
  viewport(width, height) { return browserRuntime().viewport(width, height); },
});
`.trimStart()],
]);

export interface VelarWebRuntimeConfig {
  readonly base: string;
  readonly publicConfig?: Readonly<Record<string, unknown>>;
}

export function webModuleSource(source: string, web: VelarWebRuntimeConfig = { base: "/" }): string | null {
  const value = webModuleSources.get(source);
  if (!value) return null;
  if (source === "velar/web") return value.replace(JSON.stringify("__VELAR_WEB_BASE__"), JSON.stringify(web.base));
  if (source === "velar/config") {
    return value.replace(JSON.stringify("__VELAR_PUBLIC_CONFIG__"), JSON.stringify(web.publicConfig ?? {}));
  }
  return value;
}
