/**
 * `velar/browser` — location and environment, layout measurement, selection, the watcher family, and frames.
 *
 * D115 §三: one file per `velar/*` surface, holding that surface's `ValueType`
 * tables and the `webModuleInterfaces` entry they build.
 */
import { optionalOf as optional, type ModuleInterface } from "@velarscript/compiler";
import {
  arrayNumber,
  arrayString,
  boolType,
  cleanupType,
  dialogElementType,
  durationType,
  functionType,
  mapString,
  moduleInterface,
  namedFunction,
  nullType,
  numberType,
  object,
  promise,
  stringType,
  textAreaElementType,
  unknownType,
  webElementType,
} from "./types.ts";

const browserLocationType = object({
  href: stringType,
  origin: stringType,
  path: stringType,
  query: mapString(stringType),
  hash: stringType,
});
const browserEnvironmentType = object({
  language: stringType,
  languages: arrayString,
  online: boolType,
  visible: boolType,
  colorScheme: stringType,
  reducedMotion: boolType,
  touch: boolType,
});
export const rectType = object({
  x: numberType, y: numberType, width: numberType, height: numberType,
  top: numberType, right: numberType, bottom: numberType, left: numberType,
});
const scrollMetricsType = object({
  x: numberType, y: numberType,
  viewportWidth: numberType, viewportHeight: numberType,
  contentWidth: numberType, contentHeight: numberType,
});
// P2a-4 — `watchIntersection` completes the `velar/browser` watcher family for
// the one question the family could not answer: has *this element* entered or
// left the viewport. The family's shape is kept exactly — a callback plus a
// `() -> null` cleanup, never a live host object — and the entry carries the
// two fields the platform actually guarantees for a single observed target.
// `time` and the four rectangles are deliberately absent: a rectangle read from
// an observer entry is a layout snapshot from the *observation* moment rather
// than from now, so publishing it would invite exactly the read-a-stale-box
// mistake `measure` exists to avoid.
//
// The configuration is closed rather than an options passthrough: a `root` that
// scopes the observation to a scroll container, and a bounded threshold list.
// `rootMargin` is not in it — it is a CSS-string dialect parsed by the host,
// which is the one thing a checked surface must not accept as a string.
const intersectionEntryType = object({ intersecting: boolType, ratio: numberType });
const intersectionOptionsType = object({ root: optional(webElementType), thresholds: optional(arrayNumber) });
const textSelectionType = object({ start: numberType, end: numberType, direction: stringType });

export const velarBrowserModuleEntry: readonly [string, ModuleInterface] = ["velar/browser", moduleInterface(new Map([
  ["after", namedFunction(["duration", "callback"], [durationType, functionType([], unknownType)], cleanupType)],
  ["location", namedFunction([], [], browserLocationType)],
  ["environment", namedFunction([], [], browserEnvironmentType)],
  // D104 rule 4: the two halves of the system clipboard read as a pair. The
  // write used to be `copyText`, and a consumer surveying this table for a
  // "copy this answer" button found `readClipboardText`, `clipboardText` and
  // `setClipboardText` — a read and an event pair — and concluded the module
  // could not write. The capability was there under a name that did not
  // answer the question being asked, which is the same defect as a missing
  // capability from where the author is standing.
  ["readClipboardText", namedFunction([], [], promise(stringType))],
  ["writeClipboardText", namedFunction(["value"], [stringType], promise(nullType))],
  ["open", namedFunction(["url", "target"], [stringType, stringType], nullType, 1)],
  ["scrollTo", namedFunction(["x", "y", "behavior"], [numberType, numberType, stringType], nullType, 2)],
  ["scrollIntoView", namedFunction(["element", "behavior"], [webElementType, stringType], nullType, 1)],
  ["scrollMetrics", namedFunction(["element"], [webElementType], scrollMetricsType)],
  ["scrollElementTo", namedFunction(["element", "x", "y", "behavior"], [webElementType, numberType, numberType, stringType], nullType, 3)],
  ["focus", namedFunction(["element", "preventScroll"], [webElementType, boolType], nullType, 1)],
  ["blur", namedFunction(["element"], [webElementType], nullType)],
  ["measure", namedFunction(["element"], [webElementType], rectType)],
  ["textSelection", namedFunction(["element"], [textAreaElementType], textSelectionType)],
  ["setTextSelection", namedFunction(["element", "start", "end", "direction"], [textAreaElementType, numberType, numberType, stringType], nullType, 3)],
  ["clipboardText", namedFunction(["event"], [{ kind: "named", name: "ClipboardEvent" }], stringType)],
  ["setClipboardText", namedFunction(["event", "value"], [{ kind: "named", name: "ClipboardEvent" }, stringType], nullType)],
  ["capturePointer", namedFunction(["element", "pointerId"], [webElementType, numberType], nullType)],
  ["releasePointer", namedFunction(["element", "pointerId"], [webElementType, numberType], nullType)],
  ["media", namedFunction(["query"], [stringType], boolType)],
  ["watchIntersection", namedFunction(["element", "callback", "options"], [webElementType, functionType([intersectionEntryType], unknownType), intersectionOptionsType], cleanupType, 2)],
  ["watchMedia", namedFunction(["query", "callback"], [stringType, functionType([boolType], unknownType)], cleanupType)],
  ["watchOnline", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
  ["watchVisibility", namedFunction(["callback"], [functionType([boolType], unknownType)], cleanupType)],
  ["showDialog", namedFunction(["dialog"], [dialogElementType], nullType)],
  ["closeDialog", namedFunction(["dialog", "result"], [dialogElementType, stringType], nullType, 1)],
  ["dialogResult", namedFunction(["dialog"], [dialogElementType], stringType)],
  ["every", namedFunction(["duration", "callback"], [durationType, functionType([], unknownType)], cleanupType)],
  ["frame", namedFunction([], [], promise(numberType))],
]))];
