(() => {
  "use strict";
  const key = Symbol.for("velar.browser.test.performance.v1");
  const existing = Object.getOwnPropertyDescriptor(globalThis, key);
  if (existing) {
    if (!("value" in existing) || !existing.value || typeof existing.value !== "object") {
      throw new TypeError("Browser performance test runtime identity is invalid");
    }
    return;
  }
  const nativeObject = globalThis.Object;
  const nativeNumber = globalThis.Number;
  const nativeArray = globalThis.Array;
  const nativeMath = globalThis.Math;
  const nativeMap = globalThis.Map;
  const nativePromise = globalThis.Promise;
  const nativeReflect = globalThis.Reflect;
  const nativePerformance = globalThis.performance;
  const nativeDocument = globalThis.document;
  const nativeEventTarget = globalThis.EventTarget;
  const nativeEvent = globalThis.Event;
  const nativeElement = globalThis.Element;
  const nativeDOMRectReadOnly = globalThis.DOMRectReadOnly;
  const nativeCSSStyleDeclaration = globalThis.CSSStyleDeclaration;
  const getComputedStyle_ = globalThis.getComputedStyle;
  const getOwnPropertyDescriptor = nativeObject.getOwnPropertyDescriptor;
  const defineProperty = nativeObject.defineProperty;
  const freeze = nativeObject.freeze;
  const getPrototypeOf = nativeObject.getPrototypeOf;
  const reflectApply = getOwnPropertyDescriptor(nativeReflect, "apply")?.value;
  const numberFinite = getOwnPropertyDescriptor(nativeNumber, "isFinite")?.value;
  const arrayIsArray = getOwnPropertyDescriptor(nativeArray, "isArray")?.value;
  const mathMax = getOwnPropertyDescriptor(nativeMath, "max")?.value;
  const mapPrototype = getOwnPropertyDescriptor(nativeMap, "prototype")?.value;
  const mapGet = getOwnPropertyDescriptor(mapPrototype, "get")?.value;
  const mapSet = getOwnPropertyDescriptor(mapPrototype, "set")?.value;
  const mapDelete = getOwnPropertyDescriptor(mapPrototype, "delete")?.value;
  const mapSize = getOwnPropertyDescriptor(mapPrototype, "size")?.get;
  const eventAdd = getOwnPropertyDescriptor(nativeEventTarget.prototype, "addEventListener")?.value;
  const eventRemove = getOwnPropertyDescriptor(nativeEventTarget.prototype, "removeEventListener")?.value;
  const eventTarget = getOwnPropertyDescriptor(nativeEvent.prototype, "target")?.get;
  const eventTimeStamp = getOwnPropertyDescriptor(nativeEvent.prototype, "timeStamp")?.get;
  const elementScrollTo = getOwnPropertyDescriptor(nativeElement.prototype, "scrollTo")?.value;
  const elementBoundingClientRect = getOwnPropertyDescriptor(nativeElement.prototype, "getBoundingClientRect")?.value;
  const domRectPrototype = getOwnPropertyDescriptor(nativeDOMRectReadOnly, "prototype")?.value;
  const rectX = getOwnPropertyDescriptor(domRectPrototype, "x")?.get;
  const rectY = getOwnPropertyDescriptor(domRectPrototype, "y")?.get;
  const rectWidth = getOwnPropertyDescriptor(domRectPrototype, "width")?.get;
  const rectHeight = getOwnPropertyDescriptor(domRectPrototype, "height")?.get;
  const rectTop = getOwnPropertyDescriptor(domRectPrototype, "top")?.get;
  const rectRight = getOwnPropertyDescriptor(domRectPrototype, "right")?.get;
  const rectBottom = getOwnPropertyDescriptor(domRectPrototype, "bottom")?.get;
  const rectLeft = getOwnPropertyDescriptor(domRectPrototype, "left")?.get;
  const cssStylePrototype = getOwnPropertyDescriptor(nativeCSSStyleDeclaration, "prototype")?.value;
  const cssGetPropertyValue = getOwnPropertyDescriptor(cssStylePrototype, "getPropertyValue")?.value;
  const performancePrototype = callPrototype(nativePerformance);
  const performanceNow = getOwnPropertyDescriptor(performancePrototype, "now")?.value;
  const performanceEntriesByType = getOwnPropertyDescriptor(performancePrototype, "getEntriesByType")?.value;
  const performanceEntriesByName = getOwnPropertyDescriptor(performancePrototype, "getEntriesByName")?.value;
  const performanceTimeOrigin = nativePerformance.timeOrigin;
  const queueMicrotask_ = getOwnPropertyDescriptor(globalThis, "queueMicrotask")?.value;
  const requestAnimationFrame_ = getOwnPropertyDescriptor(globalThis, "requestAnimationFrame")?.value;
  const setTimeout_ = getOwnPropertyDescriptor(globalThis, "setTimeout")?.value;
  const clearTimeout_ = getOwnPropertyDescriptor(globalThis, "clearTimeout")?.value;
  const measurements = new nativeMap();
  let nextMeasurement = 1;

  function callPrototype(value) {
    if (typeof getPrototypeOf !== "function") throw new TypeError("Object.getPrototypeOf is unavailable");
    return getPrototypeOf(value);
  }
  function call(operation, receiver, args, name) {
    if (typeof operation !== "function" || typeof reflectApply !== "function") throw new TypeError(name + " is unavailable");
    return reflectApply(operation, receiver, args);
  }
  function finite(value, name) {
    if (!call(numberFinite, nativeNumber, [value], "Number.isFinite") || value < 0 || value > 600000) {
      throw new RangeError(name + " is outside the browser performance test bound");
    }
    return value;
  }
  function now() { return finite(call(performanceNow, nativePerformance, [], "performance.now"), "Browser monotonic time"); }
  function entries(operation, value) {
    const result = call(operation, nativePerformance, [value], "Performance entry lookup");
    if (!call(arrayIsArray, nativeArray, [result], "Array.isArray") || result.length > 10000) throw new TypeError("Browser performance entries are invalid");
    return result;
  }
  function field(value, name) {
    const descriptor = value && getOwnPropertyDescriptor(value, name);
    if (descriptor && "value" in descriptor) return descriptor.value;
    let prototype = value && callPrototype(value);
    for (let depth = 0; prototype && depth < 8; depth += 1) {
      const getter = getOwnPropertyDescriptor(prototype, name)?.get;
      if (typeof getter === "function") return call(getter, value, [], "Performance entry " + name);
      prototype = callPrototype(prototype);
    }
    throw new TypeError("Performance entry " + name + " is unavailable");
  }
  function timings() {
    const navigation = entries(performanceEntriesByType, "navigation")[0];
    if (!navigation) throw new Error("The browser did not expose navigation timing");
    const paints = entries(performanceEntriesByName, "first-contentful-paint");
    const paint = paints.length === 0 ? null : finite(field(paints[0], "startTime"), "First contentful paint");
    return freeze({
      firstContentfulPaintMs: paint,
      domContentLoadedMs: finite(field(navigation, "domContentLoadedEventEnd"), "DOMContentLoaded timing"),
      loadMs: finite(field(navigation, "loadEventEnd"), "Load timing"),
    });
  }
  function scroll(element, x, y) {
    if (!(element instanceof nativeElement)) throw new TypeError("Browser test scroll target must be an Element");
    if (typeof x !== "number" || !call(numberFinite, nativeNumber, [x], "Number.isFinite")
      || typeof y !== "number" || !call(numberFinite, nativeNumber, [y], "Number.isFinite")
      || call(mathMax, nativeMath, [x, -x, y, -y], "Math.max") > 100000000) {
      throw new RangeError("Browser test scroll coordinates are outside the supported bound");
    }
    call(elementScrollTo, element, [{ left: x, top: y, behavior: "auto" }], "Element.scrollTo");
    return null;
  }
  function rectangleNumber(rectangle, getter, name) {
    const value = call(getter, rectangle, [], "DOMRect." + name);
    if (typeof value !== "number" || !call(numberFinite, nativeNumber, [value], "Number.isFinite")) {
      throw new TypeError("Browser test rectangle " + name + " is not finite");
    }
    return value;
  }
  function box(element) {
    if (!(element instanceof nativeElement)) throw new TypeError("browser.box target must be an Element");
    const rectangle = call(elementBoundingClientRect, element, [], "Element.getBoundingClientRect");
    return freeze({
      x: rectangleNumber(rectangle, rectX, "x"),
      y: rectangleNumber(rectangle, rectY, "y"),
      width: rectangleNumber(rectangle, rectWidth, "width"),
      height: rectangleNumber(rectangle, rectHeight, "height"),
      top: rectangleNumber(rectangle, rectTop, "top"),
      right: rectangleNumber(rectangle, rectRight, "right"),
      bottom: rectangleNumber(rectangle, rectBottom, "bottom"),
      left: rectangleNumber(rectangle, rectLeft, "left"),
    });
  }
  function style(element, property) {
    if (!(element instanceof nativeElement)) throw new TypeError("browser.style target must be an Element");
    if (typeof property !== "string") throw new TypeError("browser.style property must be text");
    const declaration = call(getComputedStyle_, globalThis, [element], "getComputedStyle");
    const value = call(cssGetPropertyValue, declaration, [property], "CSSStyleDeclaration.getPropertyValue");
    if (typeof value !== "string") throw new TypeError("browser.style result must be text");
    return value;
  }
  function prepare(element, eventName) {
    if (eventName !== "click" && eventName !== "input" && eventName !== "beforeinput-or-input") {
      throw new TypeError("Measured browser event must be click, input, or beforeinput-or-input");
    }
    if (!(element instanceof nativeEventTarget)) throw new TypeError("Measured browser target must be an EventTarget");
    if (call(mapSize, measurements, [], "Map.size") >= 32) throw new RangeError("Too many pending browser performance measurements");
    const eventNames = eventName === "beforeinput-or-input" ? ["beforeinput", "input"] : [eventName];
    const id = nextMeasurement++;
    let finish;
    let fail;
    const promise = new nativePromise((resolve, reject) => { finish = resolve; fail = reject; });
    let timer = null;
    let listening = true;
    const cleanup = () => {
      if (listening) {
        listening = false;
        for (const name of eventNames) call(eventRemove, nativeDocument, [name, listener, true], "Document.removeEventListener");
      }
      if (timer !== null) {
        call(clearTimeout_, globalThis, [timer], "clearTimeout");
        timer = null;
      }
    };
    const listener = (event) => {
      if (call(eventTarget, event, [], "Event.target") !== element) return;
      cleanup();
      try {
        const listenerStart = now();
        let eventTime = call(eventTimeStamp, event, [], "Event.timeStamp");
        if (typeof eventTime !== "number" || !call(numberFinite, nativeNumber, [eventTime], "Number.isFinite")) eventTime = listenerStart;
        if (eventTime > listenerStart + 1000 && typeof performanceTimeOrigin === "number") eventTime -= performanceTimeOrigin;
        if (eventTime < 0 || eventTime > listenerStart + 1000) eventTime = listenerStart;
        const inputDelayMs = finite(call(mathMax, nativeMath, [0, listenerStart - eventTime], "Math.max"), "Input delay");
        call(queueMicrotask_, globalThis, [() => {
          try {
            const processingDurationMs = finite(call(mathMax, nativeMath, [0, now() - listenerStart], "Math.max"), "Input processing duration");
            call(requestAnimationFrame_, globalThis, [(frameTime) => {
              try {
                const nextFrameMs = finite(call(mathMax, nativeMath, [inputDelayMs + processingDurationMs, frameTime - eventTime], "Math.max"), "Next frame timing");
                finish(freeze({ inputDelayMs, processingDurationMs, nextFrameMs }));
              } catch (error) { fail(error); }
            }], "requestAnimationFrame");
          } catch (error) { fail(error); }
        }], "queueMicrotask");
      } catch (error) { fail(error); }
    };
    for (const name of eventNames) call(eventAdd, nativeDocument, [name, listener, true], "Document.addEventListener");
    timer = call(setTimeout_, globalThis, [() => { cleanup(); fail(new Error("Measured browser interaction did not dispatch its expected event")); }, 5000], "setTimeout");
    call(mapSet, measurements, [id, freeze({ promise, cleanup })], "Map.set");
    return id;
  }
  async function finishMeasurement(id) {
    const measurement = call(mapGet, measurements, [id], "Map.get");
    if (!measurement) throw new Error("Browser performance measurement is unknown");
    try { return await measurement.promise; }
    finally { measurement.cleanup(); call(mapDelete, measurements, [id], "Map.delete"); }
  }
  function cancel(id) {
    const measurement = call(mapGet, measurements, [id], "Map.get");
    if (!measurement) return null;
    measurement.cleanup();
    call(mapDelete, measurements, [id], "Map.delete");
    return null;
  }
  defineProperty(globalThis, key, { value: freeze({ timings, scroll, box, style, prepare, finish: finishMeasurement, cancel }), enumerable: false, configurable: false, writable: false });
})();
