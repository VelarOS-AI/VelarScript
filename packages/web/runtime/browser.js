const timerRuntimeKey = Symbol.for("velar.runtime.v1");
const browserMediaEventConstructor = __velarBrowserConstructor("MediaQueryListEvent");
const browserMediaEventMatches = __velarBrowserPrototypeMember(browserMediaEventConstructor, "matches", "get");
function browserMediaEventField(event) {
  return __velarBrowserField(event, "matches", browserMediaEventMatches, browserMediaEventConstructor);
}
const browserIntersectionObserverConstructor = __velarBrowserConstructor("IntersectionObserver");
const browserIntersectionEntryConstructor = __velarBrowserConstructor("IntersectionObserverEntry");
const browserIntersectionObserve = __velarBrowserPrototypeMember(browserIntersectionObserverConstructor, "observe", "value");
const browserIntersectionDisconnect = __velarBrowserPrototypeMember(browserIntersectionObserverConstructor, "disconnect", "value");
const browserIntersectionIntersecting = __velarBrowserPrototypeMember(browserIntersectionEntryConstructor, "isIntersecting", "get");
const browserIntersectionRatio = __velarBrowserPrototypeMember(browserIntersectionEntryConstructor, "intersectionRatio", "get");

function browserNumber(value, name) { if (!Number.isFinite(value)) throw new TypeError(name + " must be a finite number"); return value; }
function browserBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
function browserText(value, name, maximum) { value = __velarString(value, name); if (value.length > maximum) throw new RangeError(name + " is too long"); return value; }
function browserQuery(search) {
  search = browserText(search, "Browser location query", 2 * 1024 * 1024);
  if (typeof __velarBrowserUrlSearchParamsConstructor !== "function" || typeof __velarBrowserUrlSearchParamsForEach !== "function") {
    throw new TypeError("The browser URLSearchParams API is unavailable");
  }
  const output = new Map();
  let count = 0;
  const params = new __velarBrowserUrlSearchParamsConstructor(search);
  __velarBrowserCallCaptured(__velarBrowserUrlSearchParamsForEach, params, [(value, name) => {
    count += 1;
    if (count > 100000) throw new RangeError("Browser location queries cannot exceed 100000 fields");
    output.set(name, value);
  }], "URLSearchParams.forEach");
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
  if (typeof value !== "string") throw new TypeError(name + " requires Duration; write a value such as 200ms or 2s");
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value);
  if (!match) throw new TypeError(name + " requires Duration; write a value such as 200ms or 2s");
  const milliseconds = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2147483647 || (positive && milliseconds === 0)) {
    throw new RangeError(name + (positive ? " requires a Duration above 0ms through 2147483647ms" : " requires a Duration from 0ms through 2147483647ms"));
  }
  return milliseconds;
}

function reportTimerFailure(failure, detail) {
  const error = __velarNormalizeError(failure);
  const runtime = globalThis[timerRuntimeKey];
  if (runtime && typeof runtime.report === "function") {
    runtime.report(error, { phase: "timer", detail, unhandled: true });
  } else {
    __velarBrowserCallCaptured(__velarBrowserQueueMicrotask, __velarBrowserWindow, [() => { throw error; }], "queueMicrotask");
  }
}

async function invokeTimer(callback, detail) {
  try {
    const observed = __velarObservePromise(
      callback(),
      (failure) => __velarReportOwnedCallback(failure, "timer", detail),
    );
    if (observed) await observed;
  }
  catch (error) { reportTimerFailure(error, detail); }
}

export function after(value, callback) {
  const duration = timerDuration(value, "after", false);
  if (typeof callback !== "function") throw new TypeError("after requires a callback");
  let active = true;
  const timer = __velarBrowserCallCaptured(__velarBrowserSetTimeout, __velarBrowserWindow, [() => {
    if (!active) return;
    active = false;
    void invokeTimer(callback, "after");
  }, duration], "setTimeout");
  return () => { active = false; __velarBrowserCallCaptured(__velarBrowserClearTimeout, __velarBrowserWindow, [timer], "clearTimeout"); return null; };
}

export function every(value, callback) {
  const duration = timerDuration(value, "every", true);
  if (typeof callback !== "function") throw new TypeError("every requires a callback");
  let active = true;
  let timer = null;
  const schedule = () => {
    if (!active) return;
    timer = __velarBrowserCallCaptured(__velarBrowserSetTimeout, __velarBrowserWindow, [async () => {
      if (!active) return;
      await invokeTimer(callback, "every");
      schedule();
    }, duration], "setTimeout");
  };
  schedule();
  return () => { active = false; if (timer !== null) __velarBrowserCallCaptured(__velarBrowserClearTimeout, __velarBrowserWindow, [timer], "clearTimeout"); return null; };
}

export function location() {
  __velarBrowserRequireHost("location()"); const value = __velarBrowserLocation;
  return Object.freeze({
    href: browserText(__velarBrowserField(value, "href", __velarBrowserLocationHref, __velarBrowserLocationConstructor), "Browser location URL", 2 * 1024 * 1024),
    origin: browserText(__velarBrowserField(value, "origin", __velarBrowserLocationOrigin, __velarBrowserLocationConstructor), "Browser location origin", 2 * 1024 * 1024),
    path: browserText(__velarBrowserField(value, "pathname", __velarBrowserLocationPathname, __velarBrowserLocationConstructor), "Browser location path", 2 * 1024 * 1024),
    query: browserQuery(__velarBrowserField(value, "search", __velarBrowserLocationSearch, __velarBrowserLocationConstructor)),
    hash: browserText(__velarBrowserField(value, "hash", __velarBrowserLocationHash, __velarBrowserLocationConstructor), "Browser location hash", 2 * 1024 * 1024),
  });
}

export function environment() {
  __velarBrowserRequireHost("environment()"); const navigatorValue = __velarBrowserNavigator;
  const language = browserText(__velarBrowserField(navigatorValue, "language", __velarBrowserNavigatorLanguage, __velarBrowserNavigatorConstructor), "Browser language", 256);
  const languages = browserLanguages(__velarBrowserField(navigatorValue, "languages", __velarBrowserNavigatorLanguages, __velarBrowserNavigatorConstructor));
  const online = __velarBrowserField(navigatorValue, "onLine", __velarBrowserNavigatorOnline, __velarBrowserNavigatorConstructor);
  const touchPoints = __velarBrowserField(navigatorValue, "maxTouchPoints", __velarBrowserNavigatorTouchPoints, __velarBrowserNavigatorConstructor);
  if (typeof online !== "boolean") throw new TypeError("Browser online state must be bool");
  const visibility = __velarBrowserField(__velarBrowserDocument, "visibilityState", __velarBrowserDocumentVisibility, __velarBrowserDocumentConstructor);
  if (visibility !== "visible" && visibility !== "hidden") throw new TypeError("Browser visibility state is invalid");
  const darkMatcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, ["(prefers-color-scheme: dark)"], "matchMedia");
  const reducedMatcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, ["(prefers-reduced-motion: reduce)"], "matchMedia");
  const dark = __velarBrowserField(darkMatcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor);
  const reduced = __velarBrowserField(reducedMatcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor);
  if (typeof dark !== "boolean" || typeof reduced !== "boolean") throw new TypeError("Browser media preferences must be bool");
  if (!Number.isSafeInteger(touchPoints) || touchPoints < 0 || touchPoints > 1000) throw new RangeError("Browser touch points are outside VelarScript limits");
  return Object.freeze({
    language,
    languages,
    online,
    visible: visibility === "visible",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reduced,
    touch: touchPoints > 0,
  });
}

function clipboard(entry) {
  __velarBrowserRequireHost(entry); const value = __velarBrowserClipboard;
  if (__velarBrowserSecureContext !== true || !__velarBrowserNativeInstance(value, __velarBrowserClipboardConstructor)
    || typeof __velarBrowserClipboardWrite !== "function" || typeof __velarBrowserClipboardRead !== "function") {
    throw new Error("Clipboard access requires a secure browser context");
  }
  return value;
}

export async function readClipboardText() { return browserText(await __velarBrowserCallCaptured(__velarBrowserClipboardRead, clipboard("readClipboardText()"), [], "Clipboard.readText"), "Clipboard text", 16 * 1024 * 1024); }
export async function writeClipboardText(value) { value = browserText(value, "Clipboard text", 16 * 1024 * 1024); await __velarBrowserCallCaptured(__velarBrowserClipboardWrite, clipboard("writeClipboardText()"), [value], "Clipboard.writeText"); return null; }
export function open(url, target = "_blank") { url = browserText(url, "Browser URL", 2 * 1024 * 1024); target = browserText(target, "Browser target", 256); __velarBrowserCallCaptured(__velarBrowserOpen, __velarBrowserWindow, [url, target, target === "_blank" ? "noopener,noreferrer" : undefined], "open"); return null; }
export function scrollTo(x, y, behavior = "auto") { const options = { left: browserNumber(x, "Scroll x"), top: browserNumber(y, "Scroll y"), behavior: scrollBehavior(behavior) }; __velarBrowserRequireHost("scrollTo()"); __velarBrowserCallCaptured(__velarBrowserScrollTo, __velarBrowserWindow, [options], "scrollTo"); return null; }
export function scrollIntoView(element, behavior = "smooth") { element = requireElement(element); __velarBrowserCallCaptured(__velarBrowserElementScrollIntoView, element, [{ behavior: scrollBehavior(behavior), block: "nearest" }], "Element.scrollIntoView"); return null; }
export function scrollMetrics(element) {
  element = requireElement(element);
  const x = browserNumber(__velarBrowserField(element, "scrollLeft", __velarBrowserElementScrollLeft, __velarBrowserElementConstructor), "Element scroll x");
  const y = browserNumber(__velarBrowserField(element, "scrollTop", __velarBrowserElementScrollTop, __velarBrowserElementConstructor), "Element scroll y");
  const viewportWidth = browserNumber(__velarBrowserField(element, "clientWidth", __velarBrowserElementClientWidth, __velarBrowserElementConstructor), "Element viewport width");
  const viewportHeight = browserNumber(__velarBrowserField(element, "clientHeight", __velarBrowserElementClientHeight, __velarBrowserElementConstructor), "Element viewport height");
  const contentWidth = browserNumber(__velarBrowserField(element, "scrollWidth", __velarBrowserElementScrollWidth, __velarBrowserElementConstructor), "Element content width");
  const contentHeight = browserNumber(__velarBrowserField(element, "scrollHeight", __velarBrowserElementScrollHeight, __velarBrowserElementConstructor), "Element content height");
  if (viewportWidth < 0 || viewportHeight < 0 || contentWidth < 0 || contentHeight < 0) throw new RangeError("Element scroll dimensions cannot be negative");
  return Object.freeze({ x, y, viewportWidth, viewportHeight, contentWidth, contentHeight });
}
export function scrollElementTo(element, x, y, behavior = "auto") {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementScrollTo, element, [{ left: browserNumber(x, "Element scroll x"), top: browserNumber(y, "Element scroll y"), behavior: scrollBehavior(behavior) }], "Element.scrollTo");
  return null;
}
function pointerId(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new RangeError("Pointer ID must be an integer from 0 through 2147483647");
  return value;
}
export function capturePointer(element, id) {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementSetPointerCapture, element, [pointerId(id)], "Element.setPointerCapture");
  return null;
}
export function releasePointer(element, id) {
  element = requireElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementReleasePointerCapture, element, [pointerId(id)], "Element.releasePointerCapture");
  return null;
}
export function focus(element, preventScroll = false) {
  element = requireFocusableElement(element);
  preventScroll = __velarBool(preventScroll, "Focus preventScroll");
  __velarBrowserCallCaptured(__velarBrowserElementFocus, element, [{ preventScroll }], "HTMLElement.focus");
  return null;
}
export function blur(element) {
  element = requireFocusableElement(element);
  __velarBrowserCallCaptured(__velarBrowserElementBlur, element, [], "HTMLElement.blur");
  return null;
}
export function measure(element) {
  element = requireElement(element);
  const value = __velarBrowserCallCaptured(__velarBrowserElementMeasure, element, [], "Element.getBoundingClientRect");
  return Object.freeze({
    x: browserNumber(__velarBrowserField(value, "x", __velarBrowserRectX, __velarBrowserDomRectConstructor), "Element x"),
    y: browserNumber(__velarBrowserField(value, "y", __velarBrowserRectY, __velarBrowserDomRectConstructor), "Element y"),
    width: browserNumber(__velarBrowserField(value, "width", __velarBrowserRectWidth, __velarBrowserDomRectConstructor), "Element width"),
    height: browserNumber(__velarBrowserField(value, "height", __velarBrowserRectHeight, __velarBrowserDomRectConstructor), "Element height"),
    top: browserNumber(__velarBrowserField(value, "top", __velarBrowserRectTop, __velarBrowserDomRectReadOnlyConstructor), "Element top"),
    right: browserNumber(__velarBrowserField(value, "right", __velarBrowserRectRight, __velarBrowserDomRectReadOnlyConstructor), "Element right"),
    bottom: browserNumber(__velarBrowserField(value, "bottom", __velarBrowserRectBottom, __velarBrowserDomRectReadOnlyConstructor), "Element bottom"),
    left: browserNumber(__velarBrowserField(value, "left", __velarBrowserRectLeft, __velarBrowserDomRectReadOnlyConstructor), "Element left"),
  });
}
function requireTextArea(value) {
  if (!__velarBrowserNativeInstance(value, __velarBrowserTextAreaConstructor)
    || typeof __velarBrowserTextAreaValue !== "function"
    || typeof __velarBrowserTextAreaSelectionStart !== "function"
    || typeof __velarBrowserTextAreaSelectionEnd !== "function"
    || typeof __velarBrowserTextAreaSelectionDirection !== "function"
    || typeof __velarBrowserTextAreaSetSelectionRange !== "function") {
    throw new TypeError("Text selection helpers require a <textarea> element");
  }
  return value;
}
function textAreaValue(element) {
  const value = __velarBrowserField(element, "value", __velarBrowserTextAreaValue, __velarBrowserTextAreaConstructor);
  if (typeof value !== "string" || value.length > __velarMaxTextCodeUnits) throw new TypeError("Textarea value is outside VelarScript text bounds");
  return value;
}
function selectionDirection(value) {
  if (value !== "forward" && value !== "backward" && value !== "none") throw new TypeError("Text selection direction must be forward, backward, or none");
  return value;
}
export function textSelection(element) {
  element = requireTextArea(element);
  const value = textAreaValue(element);
  const unitStart = __velarBrowserField(element, "selectionStart", __velarBrowserTextAreaSelectionStart, __velarBrowserTextAreaConstructor);
  const unitEnd = __velarBrowserField(element, "selectionEnd", __velarBrowserTextAreaSelectionEnd, __velarBrowserTextAreaConstructor);
  const direction = selectionDirection(__velarBrowserField(element, "selectionDirection", __velarBrowserTextAreaSelectionDirection, __velarBrowserTextAreaConstructor));
  if (!Number.isSafeInteger(unitStart) || !Number.isSafeInteger(unitEnd) || unitStart < 0 || unitEnd < unitStart || unitEnd > value.length) {
    throw new TypeError("Textarea selection is outside its value");
  }
  const start = __velarTextCodePointIndex(value, unitStart);
  const end = __velarTextCodePointIndex(value, unitEnd);
  if (start === null || end === null) throw new TypeError("Textarea selection cannot split a Unicode code point");
  return Object.freeze({ start, end, direction });
}
export function setTextSelection(element, start, end, direction = "none") {
  element = requireTextArea(element);
  const value = textAreaValue(element);
  const size = __velarTextCodePointLength(value);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > size) {
    throw new RangeError("Text selection must be an ordered code-point range inside the textarea value");
  }
  direction = selectionDirection(direction);
  __velarBrowserCallCaptured(__velarBrowserTextAreaSetSelectionRange, element, [
    __velarTextCodeUnitOffset(value, start),
    __velarTextCodeUnitOffset(value, end),
    direction,
  ], "HTMLTextAreaElement.setSelectionRange");
  return null;
}
function clipboardData(event) {
  if (!__velarBrowserNativeInstance(event, __velarBrowserClipboardEventConstructor)) throw new TypeError("Clipboard helpers require a ClipboardEvent");
  const data = __velarBrowserField(event, "clipboardData", __velarBrowserClipboardEventData, __velarBrowserClipboardEventConstructor);
  if (!__velarBrowserNativeInstance(data, __velarBrowserDataTransferConstructor)) throw new TypeError("ClipboardEvent does not expose native clipboard data");
  return data;
}
export function clipboardText(event) {
  const data = clipboardData(event);
  return browserText(__velarBrowserCallCaptured(__velarBrowserDataTransferGetData, data, ["text/plain"], "DataTransfer.getData"), "Clipboard event text", 16 * 1024 * 1024);
}
export function setClipboardText(event, value) {
  value = browserText(value, "Clipboard event text", 16 * 1024 * 1024);
  const data = clipboardData(event);
  __velarBrowserCallCaptured(__velarBrowserDataTransferSetData, data, ["text/plain", value], "DataTransfer.setData");
  return null;
}
export function media(query) { const matcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, [browserText(query, "Media query", 4096)], "matchMedia"); return browserBool(__velarBrowserField(matcher, "matches", __velarBrowserMediaMatches, __velarBrowserMediaQueryListConstructor), "Media query result"); }
export function watchMedia(query, callback) {
  if (typeof callback !== "function") throw new TypeError("watchMedia requires a callback");
  const matcher = __velarBrowserCallCaptured(__velarBrowserMatchMedia, __velarBrowserWindow, [browserText(query, "Media query", 4096)], "matchMedia");
  const changed = (event) => __velarInvokeOwnedRead(() => browserBool(browserMediaEventField(event), "Media watcher result"), callback, "observer", "media");
  const remove = __velarBrowserListen(matcher, "change", changed);
  return () => { remove(); return null; };
}
export function watchOnline(callback) {
  if (typeof callback !== "function") throw new TypeError("watchOnline requires a callback"); __velarBrowserRequireHost("watchOnline()");
  const changed = () => __velarInvokeOwnedRead(() => browserBool(__velarBrowserField(__velarBrowserNavigator, "onLine", __velarBrowserNavigatorOnline, __velarBrowserNavigatorConstructor), "Browser online state"), callback, "observer", "online");
  const removeOnline = __velarBrowserListenGlobal("online", changed);
  const removeOffline = __velarBrowserListenGlobal("offline", changed);
  return () => { removeOnline(); removeOffline(); return null; };
}
export function watchVisibility(callback) {
  if (typeof callback !== "function") throw new TypeError("watchVisibility requires a callback");
  __velarBrowserRequireHost("watchVisibility()"); const changed = () => __velarInvokeOwnedRead(() => {
    const visibility = __velarBrowserField(__velarBrowserDocument, "visibilityState", __velarBrowserDocumentVisibility, __velarBrowserDocumentConstructor);
    if (visibility !== "visible" && visibility !== "hidden") throw new TypeError("Browser visibility state is invalid");
    return visibility === "visible";
  }, callback, "observer", "visibility");
  const remove = __velarBrowserListen(__velarBrowserDocument, "visibilitychange", changed);
  return () => { remove(); return null; };
}
function intersectionThresholds(value) {
  if (value == null) return [0];
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw new TypeError("Intersection thresholds must be a dense List");
  }
  if (value.length === 0 || value.length > 32) throw new RangeError("Intersection thresholds must hold 1 through 32 ratios");
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Intersection thresholds cannot use accessors");
    const threshold = descriptor.value;
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new RangeError("Each intersection threshold must be a ratio from 0 through 1");
    }
    output[index] = threshold;
  }
  return output;
}
// One delivery carries every threshold the target crossed since the last one,
// oldest first. The watcher publishes the newest, which is the only entry that
// still describes the element now; the older ones describe a layout that has
// already been superseded by the time the callback runs.
function intersectionRecord(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("The browser delivered an invalid intersection record");
  const entry = entries[entries.length - 1];
  const intersecting = browserBool(__velarBrowserField(entry, "isIntersecting", browserIntersectionIntersecting, browserIntersectionEntryConstructor), "Intersection watcher result");
  const ratio = browserNumber(__velarBrowserField(entry, "intersectionRatio", browserIntersectionRatio, browserIntersectionEntryConstructor), "Intersection watcher ratio");
  if (ratio < 0 || ratio > 1) throw new RangeError("Intersection watcher ratio must be a ratio from 0 through 1");
  return Object.freeze({ intersecting, ratio });
}
export function watchIntersection(element, callback, options = {}) {
  element = requireElement(element);
  if (typeof callback !== "function") throw new TypeError("watchIntersection requires a callback");
  options = __velarOptions(options, "Intersection watcher options", __velarOptionFields(["root", "thresholds"]));
  const root = options.root == null ? null : requireElement(options.root);
  const threshold = intersectionThresholds(options.thresholds);
  if (typeof browserIntersectionObserverConstructor !== "function"
    || typeof browserIntersectionObserve !== "function" || typeof browserIntersectionDisconnect !== "function") {
    throw new TypeError("The browser does not expose native IntersectionObserver");
  }
  const observed = (entries) => __velarInvokeOwnedRead(() => intersectionRecord(entries), callback, "observer", "intersection");
  const observer = new browserIntersectionObserverConstructor(observed, { root, threshold });
  __velarBrowserCallCaptured(browserIntersectionObserve, observer, [element], "IntersectionObserver.observe");
  let stopped = false;
  return () => {
    if (!stopped) {
      stopped = true;
      __velarBrowserCallCaptured(browserIntersectionDisconnect, observer, [], "IntersectionObserver.disconnect");
    }
    return null;
  };
}
export function showDialog(dialog) {
  requireDialog(dialog);
  const connected = __velarBrowserField(dialog, "isConnected", __velarBrowserNodeConnected, __velarBrowserNodeConstructor);
  const open = __velarBrowserField(dialog, "open", __velarBrowserDialogOpen, __velarBrowserDialogConstructor);
  if (connected !== true) throw new Error("A dialog must be mounted before it can be shown");
  if (typeof open !== "boolean") throw new TypeError("Dialog open state must be bool");
  if (!open) __velarBrowserCallCaptured(__velarBrowserDialogShowModal, dialog, [], "HTMLDialogElement.showModal");
  return null;
}
export function closeDialog(dialog, result = "") {
  requireDialog(dialog);
  result = browserText(result, "Dialog result", 65536);
  const open = __velarBrowserField(dialog, "open", __velarBrowserDialogOpen, __velarBrowserDialogConstructor);
  if (typeof open !== "boolean") throw new TypeError("Dialog open state must be bool");
  if (open) __velarBrowserCallCaptured(__velarBrowserDialogClose, dialog, [result], "HTMLDialogElement.close");
  return null;
}
export function dialogResult(dialog) { requireDialog(dialog); return browserText(__velarBrowserField(dialog, "returnValue", __velarBrowserDialogResult, __velarBrowserDialogConstructor), "Dialog result", 65536); }
export function frame() { __velarBrowserRequireHost("frame()"); return new Promise((resolve, reject) => __velarBrowserCallCaptured(__velarBrowserAnimationFrame, __velarBrowserWindow, [(value) => { try { resolve(browserNumber(value, "Animation frame timestamp")); } catch (error) { reject(error); } }], "requestAnimationFrame")); }
function requireElement(value) { if (!__velarBrowserNativeInstance(value, __velarBrowserElementConstructor)) throw new TypeError("Browser element helpers require an Element"); return value; }
function requireFocusableElement(value) {
  requireElement(value);
  if (!__velarBrowserNativeInstance(value, __velarBrowserHtmlElementConstructor)) throw new TypeError("Focus helpers require an HTML element");
  return value;
}
function requireDialog(value) {
  if (!__velarBrowserNativeInstance(value, __velarBrowserDialogConstructor)
    || typeof __velarBrowserDialogShowModal !== "function" || typeof __velarBrowserDialogClose !== "function") {
    throw new TypeError("Dialog helpers require a <dialog> element");
  }
}
