/**
 * The Web surface's own answers about names: which record a runtime type name
 * carries, which event type a DOM event name resolves to, which ValueType each
 * Look property accepts, and the small rosters and sentence builders the
 * analyzer reads beside them.
 *
 * D115 P4 R3a: every one of these is a total function over a name, or the table
 * one reads. None of them needs the analyzer's walk state, so they read as a
 * module rather than as 150 lines standing between the analyzer's imports and
 * its first collaborator.
 */
import { type Diagnostic, type DiagnosticFix, type Span } from "@velarscript/compiler";
import {
  boolType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type ValueType,
} from "@velarscript/compiler/extension";
import { LOOK_PROPERTY_VALUE_KINDS, type LookPropertyValueKind } from "../look.ts";
import { WEB_EVENT_TYPE_NAMES } from "../types.ts";

// probe with this identity so they succeed in modules that use route() without
// importing RouteContext by name.
export const routeContextIdentity = "@velarscript/web:velar/web#type:RouteContext";

export const removedJsxControlAttributes = new Set(["if", "else-if", "else"]);
export const nativeDomEventNames = new Set([
  "click", "dblclick", "input", "beforeinput", "change", "submit", "reset", "invalid", "select", "toggle", "close",
  "keydown", "keyup", "keypress", "focus", "blur", "focusin", "focusout", "scroll", "wheel",
  "mousedown", "mouseup", "mousemove", "mouseenter", "mouseleave", "mouseover", "mouseout", "contextmenu",
  "pointerdown", "pointerup", "pointermove", "pointerenter", "pointerleave", "pointerover", "pointerout", "pointercancel",
  "touchstart", "touchend", "touchmove", "touchcancel",
  "dragstart", "dragend", "dragover", "dragenter", "dragleave", "drop", "drag",
  "compositionstart", "compositionupdate", "compositionend",
  "copy", "cut", "paste", "load", "error", "transitionend", "animationend", "play", "pause", "ended",
]);
// The attribute names an element really compiles as script: the browser turns
// the attribute's text into a function body in the document's origin. This is a
// different roster from `nativeDomEventNames` above, which answers "is there an
// `on:` directive worth naming for this remainder". The two used to be one set,
// so `onanimationstart` was told its name is merely reserved while the browser
// was compiling it, and before that `onward` was told the reverse. Lookups
// lowercase the written name, because an HTML attribute name is matched
// ASCII-case-insensitively. Window-reflecting handlers (`onstorage`,
// `onmessage`, `onunload`) stay out: they take effect only on `<body>`, so the
// clause would be false of the element the author actually wrote.
export const htmlEventHandlerAttributes = new Set([
  "onabort", "onauxclick", "onbeforeinput", "onbeforematch", "onbeforetoggle", "onblur", "oncancel",
  "oncanplay", "oncanplaythrough", "onchange", "onclick", "onclose", "oncontextlost", "oncontextmenu",
  "oncontextrestored", "oncopy", "oncuechange", "oncut", "ondblclick", "ondrag", "ondragend", "ondragenter",
  "ondragleave", "ondragover", "ondragstart", "ondrop", "ondurationchange", "onemptied", "onended", "onerror",
  "onfocus", "onformdata", "oninput", "oninvalid", "onkeydown", "onkeypress", "onkeyup", "onload",
  "onloadeddata", "onloadedmetadata", "onloadstart", "onmousedown", "onmouseenter", "onmouseleave",
  "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onpaste", "onpause", "onplay", "onplaying",
  "onprogress", "onratechange", "onreset", "onresize", "onscroll", "onscrollend", "onsecuritypolicyviolation",
  "onseeked", "onseeking", "onselect", "onslotchange", "onstalled", "onsubmit", "onsuspend", "ontimeupdate",
  "ontoggle", "onvolumechange", "onwaiting", "onwheel",
  "onanimationstart", "onanimationend", "onanimationiteration", "onanimationcancel",
  "ontransitionrun", "ontransitionstart", "ontransitionend", "ontransitioncancel",
  "onpointerdown", "onpointerup", "onpointermove", "onpointerover", "onpointerout", "onpointerenter",
  "onpointerleave", "onpointercancel", "ongotpointercapture", "onlostpointercapture",
  "ontouchstart", "ontouchend", "ontouchmove", "ontouchcancel",
]);
export const textualWebPrimitiveNames = new Set(["Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle"]);
// D72 rule 186: derived from the published table, not restated beside it.
export const webEventTypeNames = WEB_EVENT_TYPE_NAMES;
export const webEventDeadFields = new Set(["target", "currentTarget", "value", "checked"]);
export const diagnostic = (code: string, message: string, sourceSpan: Span, fix?: DiagnosticFix): Diagnostic =>
  fix ? { code, message, span: sourceSpan, fix } : { code, message, span: sourceSpan };
export const bindTargetGuidance = (directive: string): string =>
  `${directive} requires a writable reactive location: a state name, or a field or index path on one such as ${directive}={form.name} or ${directive}={items[0]}`;

export const lookLength: ValueType = { kind: "named", name: "Length" };
const lookPercentage: ValueType = { kind: "named", name: "Percentage" };
const lookLengthPercentage: ValueType = { kind: "named", name: "LengthPercentage" };
// LOK-D3: a length property never accepts a bare number. `width = 100` used to
// compile and reach CSS as the invalid declaration `width: 100`, which computes
// to `auto`; the unions below carry only spelled units, and the unitless-legal
// properties (opacity, zIndex, lineHeight, flex*, order, scale, aspectRatio,
// fontWeight) keep `number` individually.
const lookMetric: ValueType = { kind: "union", members: [lookLength, lookPercentage, lookLengthPercentage] };
const lookColor: ValueType = { kind: "named", name: "Color" };
const lookImage: ValueType = { kind: "named", name: "Image" };
const lookBorder: ValueType = { kind: "named", name: "Border" };
const lookShadow: ValueType = { kind: "named", name: "Shadow" };
const lookFilter: ValueType = { kind: "named", name: "Filter" };
const lookDuration: ValueType = { kind: "named", name: "Duration" };
const lookAngle: ValueType = { kind: "named", name: "Angle" };
const lookTrackList: ValueType = { kind: "named", name: "TrackList" };
const lookTransition: ValueType = { kind: "named", name: "Transition" };
const lookAnimation: ValueType = { kind: "named", name: "Animation" };
const lookSpacing: ValueType = { kind: "named", name: "Spacing" };
const lookMetricOrSpacing: ValueType = { kind: "union", members: [lookMetric, lookSpacing] };
const lookPropertyType = (kind: LookPropertyValueKind): ValueType => {
  switch (kind) {
    case "animation": return { kind: "union", members: [lookAnimation, { kind: "list", element: lookAnimation }] };
    // D73 rule 187: a published keyword must be reachable. These three kinds
    // used to type-refuse every string, so `zIndex = "auto"` -- the CSS initial
    // value -- and the five CSS-wide keywords every other property takes were
    // refused by the type before the closed set could answer. Accepting the
    // string is what makes the set they now publish a surface rather than a
    // promise (D50 rule 92); a value outside the set is still refused, by name.
    case "angle": return { kind: "union", members: [lookAngle, stringType] };
    case "background": return { kind: "union", members: [lookColor, lookImage, stringType] };
    case "border": return { kind: "union", members: [lookBorder, stringType] };
    case "color": return { kind: "union", members: [lookColor, stringType] };
    case "duration": return { kind: "union", members: [lookDuration, stringType] };
    case "image": return { kind: "union", members: [lookImage, stringType] };
    case "line-height": return { kind: "union", members: [numberType, lookLength, stringType] };
    case "metric": return { kind: "union", members: [lookMetricOrSpacing, stringType] };
    case "number": return { kind: "union", members: [numberType, stringType] };
    case "number-keyword": return { kind: "union", members: [numberType, lookSpacing, stringType] };
    case "shadow": return { kind: "union", members: [lookShadow, stringType] };
    case "track": return { kind: "union", members: [lookTrackList, stringType] };
    case "transition": return { kind: "union", members: [lookTransition, stringType] };
    case "filter": return { kind: "union", members: [lookFilter, stringType] };
    case "keyword":
    case "text":
    case "transform":
      return stringType;
  }
};
export const LOOK_PROPERTY_TYPES = new Map([...LOOK_PROPERTY_VALUE_KINDS]
  .map(([name, kind]) => [name, lookPropertyType(kind)] as const));

export function webTypeFields(name: string): ReadonlyMap<string, ValueType> | null {
  const functionType = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result });
  const eventFields = (): Map<string, ValueType> => new Map([
    ["type", stringType], ["defaultPrevented", boolType], ["preventDefault", functionType([], [], nullType)], ["stopPropagation", functionType([], [], nullType)],
  ]);
  if (name === "Event") return eventFields();
  // `isComposing` is on `InputEvent` below and belongs here for the same
  // reason: while an input method is composing, a keystroke is aimed at the
  // composer's candidate window rather than at the application. An Enter that
  // commits a candidate arrives as `keydown` with `isComposing` true, and a
  // handler that sends on Enter without asking sends half a word — which is the
  // default for every CJK typist rather than an edge case.
  if (name === "KeyboardEvent") return new Map([...eventFields(), ["key", stringType], ["code", stringType], ["repeat", boolType], ["isComposing", boolType], ["altKey", boolType], ["ctrlKey", boolType], ["metaKey", boolType], ["shiftKey", boolType]]);
  if (name === "PointerEvent") return new Map([...eventFields(), ["pointerId", numberType], ["pointerType", stringType], ["pressure", numberType], ["button", numberType], ["buttons", numberType], ["clientX", numberType], ["clientY", numberType], ["movementX", numberType], ["movementY", numberType], ["altKey", boolType], ["ctrlKey", boolType], ["metaKey", boolType], ["shiftKey", boolType]]);
  if (name === "InputEvent") return new Map([...eventFields(), ["data", optionalOf(stringType)], ["inputType", stringType], ["isComposing", boolType]]);
  if (name === "CompositionEvent") return new Map([...eventFields(), ["data", stringType]]);
  if (name === "ClipboardEvent") return eventFields();
  if (name === "Blob") return new Map();
  if (name === "File") return new Map([["name", stringType], ["size", numberType], ["type", stringType], ["modified", numberType]]);
  if (name === "Element" || name === "InputElement" || name === "TextAreaElement" || name === "CanvasElement" || name === "DialogElement") {
    const fields = new Map<string, ValueType>([["focus", functionType([], [], nullType)], ["remove", functionType([], [], nullType)]]);
    if (name === "InputElement" || name === "TextAreaElement") fields.set("value", stringType);
    if (name === "InputElement") fields.set("checked", boolType);
    if (name === "CanvasElement") { fields.set("width", numberType); fields.set("height", numberType); fields.set("getContext", functionType(["kind"], [stringType], unknownType)); }
    return fields;
  }
  return null;
}

export function webEventType(name: string): ValueType {
  if (name === "keydown" || name === "keyup" || name === "keypress") return { kind: "named", name: "KeyboardEvent" };
  if (["click", "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave"].includes(name)) return { kind: "named", name: "PointerEvent" };
  if (name === "beforeinput" || name === "input") return { kind: "named", name: "InputEvent" };
  if (name === "compositionstart" || name === "compositionupdate" || name === "compositionend") return { kind: "named", name: "CompositionEvent" };
  if (name === "copy" || name === "cut" || name === "paste") return { kind: "named", name: "ClipboardEvent" };
  return { kind: "named", name: "Event" };
}
