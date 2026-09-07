/**
 * The browser-test controller surface: the page driver, its two storage areas, and its network stub.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import { BROWSER_TEST_MODULE } from "../browser-test.ts";
import { rectType } from "./browser.ts";
import { boolType, moduleInterface, namedFunction, nullType, numberType, object, promise, stringType } from "./types.ts";

const browserTestNavigationTimingType = object({
  firstContentfulPaintMs: optional(numberType),
  domContentLoadedMs: numberType,
  loadMs: numberType,
});
const browserTestInteractionTimingType = object({
  inputDelayMs: numberType,
  processingDurationMs: numberType,
  nextFrameMs: numberType,
});
const browserTestAnimationType = object({
  count: numberType,
  name: stringType,
  rotating: boolType,
});
const browserTestControllerType = object({
  open: namedFunction(["path"], [stringType], promise(nullType), 0),
  reload: namedFunction([], [], promise(nullType)),
  click: namedFunction(["selector"], [stringType], promise(nullType)),
  fill: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  select: namedFunction(["selector", "value"], [stringType, stringType], promise(nullType)),
  press: namedFunction(["selector", "key"], [stringType, stringType], promise(nullType)),
  scroll: namedFunction(["selector", "x", "y"], [stringType, numberType, numberType], promise(nullType)),
  text: namedFunction(["selector"], [stringType], promise(stringType)),
  attribute: namedFunction(["selector", "name"], [stringType, stringType], promise(optional(stringType))),
  box: namedFunction(["selector"], [stringType], promise(rectType)),
  style: namedFunction(["selector", "property"], [stringType, stringType], promise(stringType)),
  namespace: namedFunction(["selector"], [stringType], promise(stringType)),
  count: namedFunction(["selector"], [stringType], promise(numberType)),
  visible: namedFunction(["selector"], [stringType], promise(boolType)),
  waitFor: namedFunction(["selector", "until"], [stringType, stringType], promise(nullType), 1),
  waitForText: namedFunction(["selector", "text"], [stringType, stringType], promise(nullType)),
  currentPath: namedFunction([], [], promise(stringType)),
  viewport: namedFunction(["width", "height"], [numberType, numberType], promise(nullType)),
  timings: namedFunction([], [], promise(browserTestNavigationTimingType)),
  animation: namedFunction(["selector"], [stringType], promise(browserTestAnimationType)),
  measureClick: namedFunction(["selector"], [stringType], promise(browserTestInteractionTimingType)),
  measureFill: namedFunction(["selector", "value"], [stringType, stringType], promise(browserTestInteractionTimingType)),
  measurePress: namedFunction(["selector", "key"], [stringType, stringType], promise(browserTestInteractionTimingType)),
});
const browserTestStorageControllerType = object({
  get: namedFunction(["key"], [stringType], promise(optional(stringType))),
  set: namedFunction(["key", "value"], [stringType, stringType], promise(nullType)),
  remove: namedFunction(["key"], [stringType], promise(nullType)),
  clear: namedFunction([], [], promise(nullType)),
});
const browserTestNetworkControllerType = object({
  respond: namedFunction(["path", "body", "status", "contentType", "delayMs"], [stringType, stringType, numberType, stringType, numberType], promise(nullType), 2),
  clear: namedFunction([], [], promise(nullType)),
});

export const velarBrowserTestModuleEntry: readonly [string, ModuleInterface] = [BROWSER_TEST_MODULE, moduleInterface(new Map([
  ["browser", browserTestControllerType],
  ["localStorage", browserTestStorageControllerType],
  ["sessionStorage", browserTestStorageControllerType],
  ["network", browserTestNetworkControllerType],
]))];
