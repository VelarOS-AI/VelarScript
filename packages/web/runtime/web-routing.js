export function domId(prefix = "velar") {
  prefix = __velarString(prefix, "DOM ID prefix");
  if (prefix.length > 64) throw new RangeError("DOM ID prefixes cannot exceed 64 characters");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(prefix)) throw new TypeError("DOM ID prefixes must start with a letter and contain only letters, numbers, underscores, or hyphens");
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
    const fields = __velarOptions(value, "RouteContext", __velarOptionFields(["path", "params", "query", "hash"]));
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
      ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "g")
      : __velarDomCreateElement("velar-lazy");
    if (!svg) host.style.display = "contents";
    let active = loading ? loading({}, namespace) : null;
    if (active != null && !active.__velarComponent) throw new TypeError("VelarScript lazy loading fallback must render a component");
    let mounted = false;
    let destroyed = false;
    if (active && active.__velarComponent) __velarDomAppend(host, active.node);
    else __velarDomAppend(host, __velarDomCreateComment("lazy component loading"));

    const replace = (next) => {
      if (!next || !next.__velarComponent) throw new TypeError("VelarScript lazy fallbacks must render components");
      if (destroyed) { next.destroy(); return; }
      if (active && active.__velarComponent) active.destroy(false);
      active = next;
      __velarDomReplaceChildren(host, next.node);
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
            ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "text")
            : __velarDomCreateElement("div");
          __velarDomSetAttribute(message, "role", "alert");
          __velarDomSetText(message, "Unable to load " + exportName);
          replace(component(message));
        }
      } catch (fallbackFailure) {
        const fallbackError = __velarNormalizeError(fallbackFailure);
        runtime?.report?.(fallbackError, { phase: "render", detail: "lazy-fallback:" + exportName, component: exportName, unhandled: false });
        if (active && active.__velarComponent) active.destroy(false);
        active = null;
        if (!destroyed) {
          const message = svg
            ? __velarDomCreateElementNS("http://www.w3.org/2000/svg", "text")
            : __velarDomCreateElement("div");
          __velarDomSetAttribute(message, "role", "alert");
          __velarDomSetText(message, "Unable to render " + exportName);
          __velarDomReplaceChildren(host, message);
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
  options = __velarOptions(options, "Navigation options", __velarOptionFields(["replace", "scroll"]));
  const replace = options.replace ?? false;
  const scroll = options.scroll ?? true;
  __velarBool(replace, "Navigation replace");
  __velarBool(scroll, "Navigation scroll");
  const href = internalHref(to);
  if (replace) __velarBrowserCall(__velarBrowserHistory, "replaceState", __velarBrowserHistoryReplace, __velarBrowserHistoryConstructor, [null, "", href]);
  else __velarBrowserCall(__velarBrowserHistory, "pushState", __velarBrowserHistoryPush, __velarBrowserHistoryConstructor, [null, "", href]);
  if (typeof __velarBrowserPopStateEventConstructor !== "function") throw new TypeError("The browser PopStateEvent API is unavailable");
  const event = new __velarBrowserPopStateEventConstructor("popstate");
  __velarBrowserCallCaptured(__velarBrowserGlobalDispatchEvent, __velarBrowserWindow, [event], "dispatchEvent");
  if (scroll) __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [() => {
    __velarBrowserCallCaptured(__velarBrowserScrollTo, __velarBrowserWindow, [{ top: 0, left: 0 }], "scrollTo");
  }], "requestAnimationFrame");
  return null;
}

export function redirect(to) {
  return navigate(to, { replace: true });
}

export function back() {
  __velarBrowserCall(__velarBrowserHistory, "back", __velarBrowserHistoryBack, __velarBrowserHistoryConstructor);
  return null;
}

export function forward() {
  __velarBrowserCall(__velarBrowserHistory, "forward", __velarBrowserHistoryForward, __velarBrowserHistoryConstructor);
  return null;
}

export function reload() {
  __velarBrowserCall(__velarBrowserLocation, "reload", __velarBrowserLocationReload, __velarBrowserLocationConstructor);
  return null;
}

// The document's history is one source, so the runtime listens to it once and
// hands every route reader that one subscription. Router re-renders from it and
// NavLink re-marks its aria-current from it; each used to install a window
// listener of its own, and 'currentRoute()' — which installed none — was
// therefore the one route reader that could not follow a navigation.
//
// The list is replaced rather than mutated, and it is read and written with
// index operations alone: this runs after initialization, where a live
// Set.prototype.add is exactly the reach the DOM host ABI exists to avoid.
let routeSubscribers = [];
let removeRouteSubscription = null;

function subscribeRoute(callback) {
  const added = [];
  for (let index = 0; index < routeSubscribers.length; index += 1) added[index] = routeSubscribers[index];
  added[added.length] = callback;
  routeSubscribers = added;
  if (removeRouteSubscription === null) {
    removeRouteSubscription = __velarBrowserListenGlobal("popstate", () => {
      // A Router re-rendering destroys the NavLinks on the page it replaces, so
      // a subscriber can leave while the notification is still running. The
      // snapshot is what is walked; whether each entry is still subscribed is
      // asked again, so a departed one is not called after it left -- which is
      // what a window listener removed mid-dispatch already did.
      const notified = routeSubscribers;
      for (let index = 0; index < notified.length; index += 1) {
        const subscriber = notified[index];
        const active = routeSubscribers;
        for (let scan = 0; scan < active.length; scan += 1) {
          if (active[scan] !== subscriber) continue;
          subscriber();
          break;
        }
      }
    });
  }
  return () => {
    const remaining = [];
    let removed = false;
    for (let index = 0; index < routeSubscribers.length; index += 1) {
      const subscriber = routeSubscribers[index];
      if (!removed && subscriber === callback) { removed = true; continue; }
      remaining[remaining.length] = subscriber;
    }
    if (!removed) return;
    routeSubscribers = remaining;
    if (routeSubscribers.length > 0 || removeRouteSubscription === null) return;
    removeRouteSubscription();
    removeRouteSubscription = null;
  };
}

// Reading the route inside a reactive position is a dependency on the history,
// the same way reading a state cell is a dependency on that cell — no second
// spelling, and no publishing the route back out of a mounted page by hand. The
// reactive subscription is one entry in the one listener above, taken on the
// first tracked read and kept: the graph it feeds outlives every component, and
// a read outside a reactive position takes nothing.
const routeReadSource = {};
let routeReadSubscribed = false;

function trackRoute() {
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (!runtime || typeof runtime.track !== "function" || typeof runtime.trigger !== "function") return;
  const observer = runtime.activeObserver;
  if (!observer || observer.stopped) return;
  if (!routeReadSubscribed) {
    routeReadSubscribed = true;
    subscribeRoute(() => runtime.trigger(routeReadSource, "path"));
  }
  runtime.track(routeReadSource, "path");
}

export function currentRoute() {
  trackRoute();
  const path = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname)) ?? "/";
  return Object.freeze({ path, params: new Map(), query: queryValues(), hash: routeHash() });
}

const headPropFields = __velarOptionFields(["title", "description", "canonical", "robots", "image", "themeColor", "language"]);

function headMetadata(props) {
  props = __velarLiveOptions(props, "Head props", headPropFields);
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
  return { title, description, canonical, robots, image, themeColor, language };
}

// Head follows Vel's ordinary rules: its props are read inside a DOM observer,
// so a title built from state tracks that state. Reading each prop exactly once
// at construction froze '<Head title={f"Inbox ({unread})"} />' at whatever
// count the first render saw, and the frozen-read report that exists to catch
// exactly that is muted on the snapshot path by construction.
// The observer is created at construction so the props are validated where they
// always were, and the document is not touched until mount: what a Head owns it
// takes on insertion and gives back on removal.
export function Head(props) {
  let live = false;
  let pending = null;
  let applied = null;
  let previousTitle = "";
  let previousLanguage = null;
  let restorers = [];
  const release = () => {
    if (applied === null) return;
    if (document.title === applied.title) document.title = previousTitle;
    if (applied.language && document.documentElement.getAttribute("lang") === applied.language) {
      if (previousLanguage == null) document.documentElement.removeAttribute("lang");
      else document.documentElement.setAttribute("lang", previousLanguage);
    }
    for (const restore of restorers.reverse()) restore();
    restorers = [];
    applied = null;
  };
  const take = (next) => {
    previousTitle = document.title;
    document.title = next.title;
    previousLanguage = document.documentElement.getAttribute("lang");
    if (next.language) document.documentElement.setAttribute("lang", next.language);
    restorers = [
      ownHead('meta[name="description"]', "meta", "name", "description", "content", next.description),
      ownHead('link[rel="canonical"]', "link", "rel", "canonical", "href", next.canonical),
      ownHead('meta[name="robots"]', "meta", "name", "robots", "content", next.robots),
      ownHead('meta[property="og:image"]', "meta", "property", "og:image", "content", next.image),
      ownHead('meta[name="theme-color"]', "meta", "name", "theme-color", "content", next.themeColor),
    ];
    applied = next;
  };
  // The observer runs once here, so an invalid Head is still rejected before a
  // single DOM call is made -- and the validating read happens inside the
  // observer, where D70's frozen-read report correctly ignores it.
  const observer = webObserve(() => {
    pending = headMetadata(props);
    if (!live) return;
    release();
    take(pending);
  }, "head", "Head");
  const node = document.createComment("velar head");
  return component(node, () => {
    live = true;
    take(pending);
  }, () => {
    observer.stop();
    release();
  });
}

// A DOM-phase observer built from the shared runtime registry. A component the
// runtime implements is rendered content like any other, so its reads belong in
// the queue every other rendered position uses: the reactive graph settles
// first, then the document is written once.
function webObserve(run, detail, componentName) {
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (!runtime || typeof runtime.runTracked !== "function" || typeof runtime.schedule !== "function"
    || typeof runtime.cleanupObserver !== "function") {
    throw new TypeError("A VelarScript Web component requires the VelarScript Web runtime");
  }
  let initial = true;
  const observer = {
    mode: "dom",
    stopped: false,
    dependencies: new Set(),
    run() {
      if (observer.stopped) return;
      // The first run happens while the component is being constructed, and
      // construction is transactional: that failure belongs to the caller.
      // Every later run is an update, whose failure is reported.
      try { runtime.runTracked(observer, run); }
      catch (failure) {
        // Construction is transactional, and now that these components read
        // live props the first run has already subscribed to whatever it read
        // on the way to failing. A component that never came into existence
        // leaves nothing behind that a later write could re-run.
        if (initial) { observer.stop(); throw failure; }
        const error = __velarNormalizeError(failure);
        if (typeof runtime.report === "function") runtime.report(error, { phase: "render", detail, component: componentName, unhandled: true });
        else __velarBrowserCallCaptured(__velarBrowserQueueMicrotask, __velarBrowserWindow, [() => { throw error; }], "queueMicrotask");
      }
      finally { initial = false; }
    },
    notify() { if (!observer.stopped) runtime.schedule(observer); },
    stop() { observer.stopped = true; runtime.cleanupObserver(observer); },
  };
  observer.run();
  return observer;
}

// Reading props inside an observer is what makes a component follow its state;
// building a subtree there is not. A component the runtime implements calls
// another component directly rather than through the emitted instantiation
// path, so it needs that path's guard: the reactive graph records a dependency
// only for an observer it will run again, and a stopped one is exactly the
// shape it refuses to record.
function webUntracked(run) {
  const runtime = globalThis[Symbol.for("velar.runtime.v1")];
  if (!runtime || typeof runtime.runTracked !== "function") {
    throw new TypeError("A VelarScript Web component requires the VelarScript Web runtime");
  }
  return runtime.runTracked({ mode: "dom", stopped: true, dependencies: new Set(), spareDependencies: null, notify() {} }, run);
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
  __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [() => { region.textContent = message; }], "requestAnimationFrame");
  return null;
}

const routerPropFields = __velarOptionFields(["routes", "fallback"]);

function routerTable(props) {
  props = __velarLiveOptions(props, "Router props", routerPropFields);
  let { routes, fallback = null } = props;
  const routeItems = __velarRequireList(routes, "Router routes");
  if (routeItems.length > 10000) throw new RangeError("A Router cannot contain more than 10000 routes");
  routes = routeItems.map((item) => {
    item = __velarOptions(item, "Router route", __velarOptionFields(["path", "component"]));
    validateRoutePath(item.path);
    if (typeof item.component !== "function") throw new TypeError("A Router route component must be callable");
    return Object.freeze({ path: item.path, component: item.component, matcher: compileRoutePath(item.path) });
  });
  if (fallback != null && typeof fallback !== "function") throw new TypeError("A Router fallback must be a component");
  return { routes, fallback };
}

export function Router(props) {
  // The host element is created by the observer's first run, after the routes
  // table has been checked: a refused table must not leave a browser node
  // behind on its way out.
  let node = null;
  let table = null;
  let active = null;
  let mounted = false;
  const notFound = ({ route }) => {
    const page = __velarDomCreateElement("main");
    __velarDomSetAttribute(page, "data-velar-not-found", "");
    const title = __velarDomCreateElement("h1");
    __velarDomSetText(title, "Page not found");
    const detail = __velarDomCreateElement("p");
    __velarDomSetText(detail, "No route matches " + route.path);
    __velarDomAppend(page, title, detail);
    return component(page);
  };
  const render = () => {
    try {
      const path = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname));
      const match = path === null ? null : matchRoute(table.routes, path);
      const context = match?.context ?? { path: path ?? "/", params: new Map(), query: queryValues(), hash: routeHash() };
      const next = webUntracked(() => (match ? match.item.component({ route: context }) : (table.fallback ?? notFound)({ route: context })));
      if (!next || !next.__velarComponent) throw new TypeError("A VelarScript Router target must render a component");
      if (active) active.destroy();
      active = next;
      __velarDomReplaceChildren(node, active.node);
      if (mounted) active.__mount();
    } catch (value) {
      const error = __velarNormalizeError(value);
      if (!mounted) throw error;
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      if (runtime && typeof runtime.report === "function") {
        runtime.report(error, { phase: "render", detail: "router", component: "Router", unhandled: true });
      } else {
        __velarBrowserCallCaptured(__velarBrowserQueueMicrotask, __velarBrowserWindow, [() => { throw error; }], "queueMicrotask");
      }
    }
  };
  const changed = () => render();
  let removeRouteListener = null;
  // The routes table is read inside the observer that renders from it, so a
  // table or fallback built from state re-renders the position that shows it.
  // A constant table subscribes to nothing and recomputes nothing.
  const observer = webObserve(() => {
    table = routerTable(props);
    if (node === null) node = __velarDomCreateElement("velar-router");
    render();
  }, "router", "Router");
  return component(node, () => {
    mounted = true;
    removeRouteListener = subscribeRoute(changed);
    if (active) active.__mount();
  }, () => {
    observer.stop();
    if (removeRouteListener) removeRouteListener();
    if (active) active.destroy(false);
  });
}

const linkPropFields = __velarOptionFields(["to", "replace", "class", "look", "children"]);

function linkTarget(props) {
  const to = __velarString(props.to, "Link target");
  if (to.length > 2 * 1024 * 1024) throw new RangeError("Link targets cannot exceed 2 MiB");
  requireNavigableTarget(to, "Link target");
  const replace = props.replace === undefined ? false : props.replace;
  __velarBool(replace, "Link replace");
  const external = isExternal(to);
  return { to, replace, external, href: external ? to : internalHref(to) };
}

// Which fields a Link carries is fixed where the Link is written, so the record
// shape is checked once; the values behind those fields are read inside the
// observer that consumes them, which is what makes '<Link to={path}>' follow
// the state 'path' holds. 'children' is rendered content owned by the position
// that shows it, so it is taken once, where that position builds it -- that is
// why the shape check sits here rather than inside the observer the way Head's
// does: reading the slot again on every update would build content nothing
// shows. Behind a live props store both reads answer from the same cached
// derived value, so the author's prop expression still runs exactly once.
export function Link(props) {
  const children = __velarLiveOptions(props, "Link props", linkPropFields).children;
  // The anchor is created by the observer's first run, after the target has
  // been checked: a refused target must not leave a browser node behind.
  let node = null;
  let target = null;
  let releaseHost = null;
  const observer = webObserve(() => {
    const next = linkTarget(props);
    if (node === null) node = __velarDomCreateElement("a");
    if (releaseHost) { releaseHost(); releaseHost = null; }
    releaseHost = forwardHost(node, props);
    node.href = next.href;
    target = next;
  }, "link", "Link");
  try { append(node, children); }
  catch (failure) { observer.stop(); if (releaseHost) releaseHost(); throw failure; }
  const clicked = (event) => {
    try {
      const defaultPrevented = webEventField(event, "defaultPrevented", webEventDefaultPrevented);
      const button = webEventField(event, "button", webEventButton);
      const metaKey = webEventField(event, "metaKey", webEventMetaKey);
      const ctrlKey = webEventField(event, "ctrlKey", webEventCtrlKey);
      const shiftKey = webEventField(event, "shiftKey", webEventShiftKey);
      const altKey = webEventField(event, "altKey", webEventAltKey);
      if (defaultPrevented === webEventMissingField || button === webEventMissingField || metaKey === webEventMissingField
        || ctrlKey === webEventMissingField || shiftKey === webEventMissingField || altKey === webEventMissingField
        || typeof defaultPrevented !== "boolean" || !Number.isSafeInteger(button)
        || typeof metaKey !== "boolean" || typeof ctrlKey !== "boolean" || typeof shiftKey !== "boolean" || typeof altKey !== "boolean") {
        throw new TypeError("Link received an invalid click event");
      }
      if (defaultPrevented || button !== 0 || metaKey || ctrlKey || shiftKey || altKey) return;
      if (target.external) return;
      if (webUrlField(webUrl(node.href, webLocationField("href", __velarBrowserLocationHref)), "origin", __velarBrowserUrlOrigin)
        !== webLocationField("origin", __velarBrowserLocationOrigin)) return;
      webEventCall(event, "preventDefault", webEventPreventDefault);
      navigate(target.to, { replace: target.replace });
    } catch (failure) { reportLinkEventFailure(failure); }
  };
  let removeClick = null;
  return component(node, () => { removeClick = __velarBrowserListen(node, "click", clicked); }, () => {
    observer.stop();
    if (removeClick) removeClick();
    if (releaseHost) releaseHost();
  });
}

const navLinkPropFields = __velarOptionFields(["to", "exact", "replace", "class", "look", "children"]);

function navLinkTarget(props) {
  const to = __velarString(props.to, "NavLink target");
  requireNavigableTarget(to, "NavLink target");
  const exact = props.exact === undefined ? false : props.exact;
  const replace = props.replace === undefined ? false : props.replace;
  __velarBool(exact, "NavLink exact");
  __velarBool(replace, "NavLink replace");
  internalHref(to);
  return { exact, path: normalizeApplicationPath(webUrlField(webUrl(to, "https://velar.invalid"), "pathname", __velarBrowserUrlPathname)) };
}

export function NavLink(props) {
  const children = __velarLiveOptions(props, "NavLink props", navLinkPropFields).children;
  let linked = null;
  let target = null;
  const update = () => {
    const application = applicationPath(webLocationField("pathname", __velarBrowserLocationPathname));
    const current = application === null ? null : normalizeApplicationPath(application);
    const active = current !== null
      && (current === target.path || (!target.exact && target.path !== "/" && current.startsWith(target.path + "/")));
    if (active) __velarDomSetAttribute(linked.node, "aria-current", "page");
    else __velarDomRemoveAttribute(linked.node, "aria-current");
  };
  // A NavLink rejects its own target before the Link it wraps sees it, so the
  // observer runs first and the message names NavLink. Its first run has no
  // Link to mark yet; the update below is that run's second half.
  const observer = webObserve(() => {
    target = navLinkTarget(props);
    if (linked !== null) update();
  }, "navlink", "NavLink");
  // The Link is handed the same live fields, not a copy of their values, so a
  // NavLink built from state moves its href as well as its aria-current.
  let removeRouteListener = null;
  try {
    linked = Link({
      get to() { return props.to; },
      get replace() { return props.replace; },
      get class() { return props.class; },
      get look() { return props.look; },
      children,
    });
    update();
  } catch (failure) {
    observer.stop();
    if (linked) linked.destroy(false);
    throw failure;
  }
  return component(linked.node, () => {
    linked.__mount();
    removeRouteListener = subscribeRoute(update);
  }, () => {
    observer.stop();
    if (removeRouteListener) removeRouteListener();
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
  const parsed = webUrl(to, "https://velar.invalid");
  const pathname = webUrlField(parsed, "pathname", __velarBrowserUrlPathname);
  const search = webUrlField(parsed, "search", __velarBrowserUrlSearch);
  const hash = webUrlField(parsed, "hash", __velarBrowserUrlHash);
  return appBase + pathname.slice(1) + search + hash;
}

function isExternal(to) {
  return typeof to === "string" && (/^[a-z][a-z\d+.-]*:/i.test(to) || to.startsWith("//"));
}

// The scheme policy a JSX URL attribute enforces, narrowed to what a Link is
// for. 'javascript:' and 'vbscript:' are code, not locations: a Link classified
// one as external, wrote it to node.href, and its click handler then let native
// anchor activation run it. Only the two schemes a page can be served over are
// navigation targets; anything else belongs to a plain <a> element.
const navigableSchemes = ["http", "https"];
function targetScheme(to) {
  let scheme = "";
  for (let index = 0; index < to.length; index += 1) {
    const code = to.charCodeAt(index);
    // The user agent strips ASCII whitespace and control characters before it
    // parses the scheme, so "java\tscript:" reads as "javascript:" to it and
    // has to read that way here too.
    if (code <= 0x20 || code === 0x7f) continue;
    if (code === 58 && scheme.length > 0) return scheme.toLowerCase();
    const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (letter || (scheme.length > 0 && ((code >= 48 && code <= 57) || code === 43 || code === 45 || code === 46))) {
      scheme += to[index];
      continue;
    }
    // Anything else this early means the value names no scheme: it is a
    // relative path, which is always the application's own origin.
    return "";
  }
  return "";
}
function requireNavigableTarget(to, label) {
  const scheme = targetScheme(to);
  if (scheme !== "" && !navigableSchemes.includes(scheme)) {
    throw new TypeError(label + " rejected the '" + scheme + ":' URL scheme; only http and https targets navigate, so write a plain <a> element for another scheme");
  }
  return to;
}

function queryValues() {
  const search = webLocationField("search", __velarBrowserLocationSearch);
  if (typeof search !== "string") throw new TypeError("Route queries require browser text");
  if (search.length > 2 * 1024 * 1024) throw new RangeError("Route queries cannot exceed 2 MiB");
  const output = new Map();
  let count = 0;
  if (typeof __velarBrowserUrlSearchParamsConstructor !== "function" || typeof __velarBrowserUrlSearchParamsForEach !== "function") {
    throw new TypeError("The browser URLSearchParams API is unavailable");
  }
  const params = new __velarBrowserUrlSearchParamsConstructor(search);
  __velarBrowserCallCaptured(__velarBrowserUrlSearchParamsForEach, params, [(value, name) => {
    count += 1;
    if (count > 100000) throw new RangeError("Route queries cannot exceed 100000 fields");
    output.set(name, value);
  }], "URLSearchParams.forEach");
  return output;
}

function routeHash() {
  const hash = webLocationField("hash", __velarBrowserLocationHash);
  if (typeof hash !== "string") throw new TypeError("Route hashes require browser text");
  if (hash.length > 2 * 1024 * 1024) throw new RangeError("Route hashes cannot exceed 2 MiB");
  return hash;
}
