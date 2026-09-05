import { mechanicalEdits, mechanicalFix, semanticTypeIdentity, type Diagnostic, type DiagnosticEdit, type DiagnosticFix, type Span } from "@velarscript/compiler";
import {
  Analyzer,
  anyType,
  boolType,
  describeType,
  expressionContainsDirectAwait,
  invalidType,
  isInvalidType,
  isAssignable,
  isReadonlyView,
  nullType,
  nonOptional,
  numberType,
  optionalOf,
  spanIdentity,
  stringType,
  unknownType,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type CompilerIntrinsicAnalysisContext,
  type Expression,
  type FormReadField,
  type Program,
  type Statement,
  type TypeReference,
  type ValueType,
} from "@velarscript/compiler/extension";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, browserTestImportGuidance } from "./browser-test.ts";
import { cssTokens } from "./css-tokens.ts";
import {
  LOOK_ABSENT_MEDIA_SUBJECTS,
  LOOK_ARITHMETIC_HINT,
  LOOK_ANIMATION_DIRECTIONS,
  LOOK_ANIMATION_EASINGS,
  LOOK_ANIMATION_FILLS,
  LOOK_BORDER_STYLE_NAMES,
  LOOK_BUILDER_NUMERIC_RANGES,
  LOOK_BUILDER_SIGNATURES,
  LOOK_BUILDERS,
  LOOK_EXCLUDED_PROPERTIES,
  LOOK_HOOKS,
  LOOK_CSS_WIDE_KEYWORDS,
  LOOK_COLOR_KEYWORDS,
  LOOK_LARGE_KEYWORD_SETS,
  LOOK_LENGTH_BUILDERS,
  LOOK_MEDIA_LENGTH_UNITS,
  LOOK_MEDIA_SUBJECTS,
  LOOK_NUMERIC_TYPE_NAMES,
  LOOK_NON_ANIMATABLE_PROPERTIES,
  LOOK_PARTIAL_KEYWORD_PROPERTIES,
  LOOK_PROPERTIES,
  LOOK_PROPERTY_KEYWORDS,
  LOOK_PROPERTY_VALUE_KINDS,
  LOOK_SHARED_METRIC_KEYWORDS,
  LOOK_TARGETS,
  LOOK_TOKEN_NAME_RULE,
  LOOK_TOKEN_NO_FALLBACK_GUIDANCE,
  LOOK_UNIT_TYPES,
  LOOK_UNITLESS_PROPERTIES,
  isLookTokenName,
  isLookVarReference,
  lookOwnKeywords,
  lookShorthandOverlap,
  lookShorthandParts,
  lookTokenReference,
  lookVarReferenceName,
  nearestLookName,
  type LookPropertyValueKind,
} from "./look.ts";
import { collectLookStaticValues, evaluateLookStaticExpression, isLookStaticValue, lookStaticCss, type LookStaticValue } from "./look-static.ts";
import { keyframeCssValue } from "./keyframes.ts";
import { byCodeUnit } from "./stable-order.ts";
import { dynamicChildLeaves, JSX_SCALAR_TEXT_HINT } from "./emitter.ts";
import {
  isWebCustomElementName,
  WEB_ARIA_ATTRIBUTES,
  WEB_ARIA_ENUMERATED_VALUES,
  WEB_ARIA_ROLES,
  WEB_ARIA_ROLE_SYNONYMS,
  WEB_BOOL_PRESENCE_HTML_ATTRIBUTES,
  WEB_HTML_ELEMENTS,
  WEB_MISSPELLED_ATTRIBUTES,
  WEB_NATIVE_ELEMENTS,
} from "./elements.ts";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
  type WebActionDeclaration as ActionDeclaration,
  type WebComponentDeclaration as ComponentDeclaration,
  type WebComputedDeclaration as ComputedDeclaration,
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
  type WebKeyframesExpression,
  type WebLookExpression,
  type WebResourceDeclaration as ResourceDeclaration,
} from "./ast.ts";
import {
  isWebComponentConstructor,
  isWebComponentType,
  isWebComputedExport,
  isWebNodeType,
  normalizeWebComponentType,
  webComponentConstructor,
  webComponentHandle,
  webComponentIntrinsic,
  webComponentName,
  webNodeType,
  WEB_EVENT_TYPE_NAMES,
  WEB_OWNED_TYPE_NAMES,
  type WebComponentType,
} from "./types.ts";

// The canonical nominal identity of the Web RouteContext record. Route checks
// probe with this identity so they succeed in modules that use route() without
// importing RouteContext by name.
export const routeContextIdentity = "@velarscript/web:velar/web#type:RouteContext";

const removedJsxControlAttributes = new Set(["if", "else-if", "else"]);
const nativeDomEventNames = new Set([
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
const htmlEventHandlerAttributes = new Set([
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
const textualWebPrimitiveNames = new Set(["Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle"]);
// D72 rule 186: derived from the published table, not restated beside it.
const webEventTypeNames = WEB_EVENT_TYPE_NAMES;
const webEventDeadFields = new Set(["target", "currentTarget", "value", "checked"]);
const diagnostic = (code: string, message: string, sourceSpan: Span, fix?: DiagnosticFix): Diagnostic =>
  fix ? { code, message, span: sourceSpan, fix } : { code, message, span: sourceSpan };
const bindTargetGuidance = (directive: string): string =>
  `${directive} requires a writable reactive location: a state name, or a field or index path on one such as ${directive}={form.name} or ${directive}={items[0]}`;
const LOOK_CONDITION_TERM_LIMIT = 32;

const lookLength: ValueType = { kind: "named", name: "Length" };
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
    case "filter":
    case "keyword":
    case "text":
    case "transform":
      return stringType;
  }
};
const LOOK_PROPERTY_TYPES = new Map([...LOOK_PROPERTY_VALUE_KINDS]
  .map(([name, kind]) => [name, lookPropertyType(kind)] as const));

/**
 * The whole read, from the module name to a working line. A blind model needed
 * five guesses to get here because each diagnostic answered only the step it
 * was standing on: the export name, then the argument count, then that the
 * second argument is a runtime type, then that a primitive spelling is not a
 * value. Storage already parses and validates the stored JSON, so the one thing
 * still missing is the named type to validate against.
 */
function storageReadGuidance(call: string): string {
  return `${call} validates what it reads and parses the stored JSON itself, so its second argument is a named runtime type: declare one — 'type SavedItems = List<Item>' — then read with 'storage.get("items", SavedItems, [])', whose third argument is the fallback for missing or invalid data, and write it back with 'storage.set("items", items)'. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values; only a declared type, enum, or alias name is one.`;
}

export function inferWebIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt } = context;
  switch (intrinsic.name) {
    case RETIRED_ACCESSOR_INTRINSIC: {
      // A call around the retired `computed(...)` returns the reader it
      // always returned, carrying the callback's own result so an annotated
      // declaration reads its migration message and nothing else. Nothing else
      // is checked here — the shape is already refused, and a second complaint
      // about a spelling that no longer exists teaches the author nothing.
      arity(1, 1);
      const callback = callbackAt(0, [], unknownType);
      const result = callback.kind === "function" || callback.kind === "intrinsic" || callback.kind === "action"
        ? callback.result
        : callback.kind === "any" ? anyType : unknownType;
      return { kind: "function", parameters: [], requiredParameters: 0, result };
    }
    case "web.route": {
      arity(2, 2);
      inferAt(0, stringType);
      const component = inferAt(1);
      const path = argumentAt(0);
      if (path?.kind === "LiteralExpression" && typeof path.value === "string") checkRoutePath(path.value, path.span, context.typeError);
      checkRouteComponent(component, argumentAt(1)?.span ?? callSpan, "A route", context);
      return { kind: "object", fields: new Map([["path", stringType], ["component", component]]) };
    }
    case "web.lazy": {
      arity(2, 4);
      const loader = inferAt(0);
      inferAt(1, stringType);
      const loadingFallback = inferAt(2);
      const failedFallback = inferAt(3);
      const loaderExpression = argumentAt(0);
      if (loaderExpression?.kind !== "ArrowFunctionExpression" || loaderExpression.parameters.length !== 0 || loaderExpression.body.kind !== "DynamicImportExpression") {
        context.typeError("A lazy loader must be written as () => import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      if (isInvalidType(loader)) return loader;
      // No `any` arm on either line: the gate above has already established
      // that argument 0 is a zero-parameter arrow, and the core analyzer infers
      // an arrow on one return path that always answers `kind: "function"`
      // (`inferArrow`). The loader is therefore never `any`, and D90 R17 —
      // which retired the JavaScript boundary that used to hand one back — left
      // nothing that could make it one.
      if (loader.kind !== "function") {
        if (loaderExpression) context.typeError(`Expected a module loader, received ${describeType(loader)}`, loaderExpression.span);
        return anyType;
      }
      if (isInvalidType(loader.result)) return loader.result;
      if (loader.parameters.length !== 0) context.typeError("A lazy module loader cannot receive parameters", loaderExpression?.span ?? callSpan);
      const moduleType = loader.result.kind === "promise" ? loader.result.value : null;
      if (!moduleType) {
        context.typeError("A lazy module loader must return import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      const nameExpression = argumentAt(1);
      const name = nameExpression?.kind === "LiteralExpression" && typeof nameExpression.value === "string" ? nameExpression.value : null;
      if (!name) {
        context.typeError("A lazy component export name must be a string literal", nameExpression?.span ?? callSpan);
        return anyType;
      }
      if (moduleType.kind !== "object") {
        context.typeError("A lazy loader must load a checked VelarScript module", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      const exported = moduleType.fields.get(name);
      if (!exported) {
        context.typeError(`Dynamically imported module has no export named '${name}'`, nameExpression?.span ?? callSpan);
        return anyType;
      }
      if (!isWebComponentConstructor(exported)) {
        context.typeError(`Dynamic export '${name}' is ${describeType(exported)}, not a component`, nameExpression?.span ?? callSpan);
        return anyType;
      }
      const loadingExpression = argumentAt(2);
      if (loadingExpression && !isInvalidType(loadingFallback) && loadingFallback.kind !== "null" && loadingFallback.kind !== "any") {
        if (!isWebComponentType(loadingFallback)) context.typeError("A lazy loading fallback must be a component", loadingExpression.span);
        else if (loadingFallback.requiredProperties.size > 0) context.typeError("A lazy loading fallback cannot require props", loadingExpression.span);
      }
      const failedExpression = argumentAt(3);
      if (failedExpression && !isInvalidType(failedFallback) && failedFallback.kind !== "null" && failedFallback.kind !== "any") {
        if (!isWebComponentType(failedFallback)) context.typeError("A lazy failure fallback must be a component accepting error: Error", failedExpression.span);
        else {
          const error = failedFallback.properties.get("error");
          if (!error || !context.isAssignable({ kind: "class", name: "Error" }, error) || [...failedFallback.requiredProperties].some((prop) => prop !== "error")) {
            context.typeError("A lazy failure fallback must accept error: Error and require no other props", failedExpression.span);
          }
        }
      }
      return exported;
    }
    case "http.request": {
      arity();
      let options: ValueType | null = null;
      for (const [index, expected] of intrinsic.parameters.entries()) {
        const actual = inferAt(index, expected);
        if (index === intrinsic.parameters.length - 1 && argumentAt(index)) options = actual;
      }
      const fields = options?.kind === "object" ? options.fields : null;
      const body = fields?.get("body");
      const expandedBody = body ? context.expandAliases(body) : null;
      const blob = expandedBody?.kind === "named" && expandedBody.name === "Blob";
      if (body && !context.isHttpFormBody(body) && !blob && context.jsonSerializable(body) === false) {
        const optionsExpression = argumentAt(intrinsic.parameters.length - 1);
        const bodyExpression = optionsExpression?.kind === "ObjectExpression"
          ? optionsExpression.properties.find((property) => property.kind === "ObjectProperty" && property.name === "body")?.value
          : null;
        context.typeError(`HTTP JSON bodies accept only records, Lists, enums, primitives, and optionals; received ${describeType(body)}`, bodyExpression?.span ?? optionsExpression?.span ?? callSpan);
      }
      return intrinsic.result;
    }
    case "storage.set": {
      arity(2, 3);
      inferAt(0, stringType);
      const value = inferAt(1);
      if (argumentAt(2)) inferAt(2, numberType);
      const valueExpression = argumentAt(1);
      if (context.jsonSerializable(value) === false && valueExpression) {
        context.typeError(`Storage values accept only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, valueExpression.span);
      }
      return intrinsic.result;
    }
    case "config.public":
      arity(1, 1);
      return runtimeTypeAt(0);
    case "storage.get": {
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("storage.get(key, Type)"), callSpan);
        return unknownType;
      }
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return parsed; }
      return optionalOf(parsed);
    }
    case "storage.databaseGet": {
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("database(name).get(key, Type)"), callSpan);
        return { kind: "promise", value: unknownType };
      }
      arity(2, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(3)) inferAt(3, numberType);
      if (argumentAt(2)) { inferAt(2, parsed); return { kind: "promise", value: parsed }; }
      return { kind: "promise", value: optionalOf(parsed) };
    }
    case "storage.watch": {
      if (!argumentAt(1)) {
        context.typeError(storageReadGuidance("storage.watch(key, Type, callback)"), callSpan);
        return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
      }
      arity(3, 4);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      callbackAt(2, [optionalOf(parsed), optionalOf(parsed)], unknownType);
      if (argumentAt(3)) inferAt(3, numberType);
      return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
    }
    case "forms.read": {
      arity(2, 2);
      inferAt(0, { kind: "named", name: "Element" });
      const parsed = runtimeTypeAt(1);
      if (parsed.kind === "any" || parsed.kind === "unknown") return parsed;
      const expanded = context.expandAliases(parsed);
      const fields = expanded.kind === "named" ? context.declaredFieldsOf(expanded.identity ?? expanded.name) : null;
      if (!fields) {
        context.typeError("Form reading requires a record declared with 'type Name:'", argumentAt(1)?.span ?? callSpan);
        return parsed;
      }
      const descriptors: FormReadField[] = [];
      for (const [name, field] of fields) {
        const descriptor = context.formReadField(name, field, argumentAt(1)?.span ?? callSpan);
        if (descriptor) descriptors.push(descriptor);
      }
      if (descriptors.length === fields.size) context.recordFormRead(callSpan, descriptors);
      return parsed;
    }
    default:
      return undefined;
  }
}

// Multi-token shorthand strings on properties with a checked builder
// equivalent bypass the builder system, so they are rejected with directive
// guidance that computes the builder call whenever the string decomposes
// cleanly. Single-token keyword strings and hex color strings stay accepted.
const lookSpacingFamily = /^(?:margin|padding|inset)/u;
const lookSpacingProperties = new Set(["borderRadius", "borderWidth"]);
const lookBorderProperties = new Set(["border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline"]);
// The border() builder's guard, the five border-style properties and this
// shorthand reader are one vocabulary, so they read one table (D57 rule 134).
const lookBorderStyles = LOOK_BORDER_STYLE_NAMES;

function lookBuilderToken(token: string): string {
  if (/^[+-]?\d+(?:\.\d+)?$/u.test(token)) return `${token}px`;
  if (/^[+-]?\d+(?:\.\d+)?[a-z%]+$/iu.test(token)) return token;
  return `"${token}"`;
}

function numericLiteral(expression: Expression | null): number | null {
  if (expression?.kind === "LiteralExpression" && typeof expression.value === "number") return expression.value;
  if (expression?.kind === "UnaryExpression" && expression.operator === "-"
    && expression.operand.kind === "LiteralExpression" && typeof expression.operand.value === "number") {
    return -expression.operand.value;
  }
  return null;
}

function coreDurationLiteral(expression: Expression | null): { readonly value: number; readonly unit: "ms" | "s"; readonly raw: string } | null {
  if (expression?.kind !== "ExtensionExpression:core:duration") return null;
  return expression as Expression & { readonly value: number; readonly unit: "ms" | "s"; readonly raw: string };
}

function lookDurationLiteral(expression: Expression | null): number | null {
  const direct = coreDurationLiteral(expression);
  if (direct) {
    return direct.value * (direct.unit === "s" ? 1000 : 1);
  }
  const operand = expression?.kind === "UnaryExpression" ? coreDurationLiteral(expression.operand) : null;
  if (expression?.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-") && operand) {
    const value = operand.value * (operand.unit === "s" ? 1000 : 1);
    return expression.operator === "-" ? -value : value;
  }
  return null;
}

function lookBorderCall(tokens: readonly string[]): string | null {
  let width: string | null = null;
  let style: string | null = null;
  let color: string | null = null;
  for (const token of tokens) {
    if (/^[+-]?\d/u.test(token) && width === null) width = lookBuilderToken(token);
    else if (lookBorderStyles.has(token) && style === null) style = token;
    else if (color === null && /^#[0-9a-f]{3,8}$/iu.test(token)) color = `color("${token}")`;
    else if (color === null && /^[a-z]+$/iu.test(token)) color = `color("${token}")`;
    else return null;
  }
  if (width === null || color === null) return null;
  const buildArguments = style !== null && style !== "solid" ? `${width}, ${color}, "${style}"` : `${width}, ${color}`;
  return `border(${buildArguments})`;
}

function lookShorthandStringGuidance(name: string, value: Expression): string | null {
  if (value.kind !== "LiteralExpression" || typeof value.value !== "string") return null;
  const text = value.value.trim();
  if ((name === "gridTemplateColumns" || name === "gridTemplateRows") && text !== "none") {
    return "Use the tracks(...) builder for grid templates; for example, write tracks(240px, minmax(0px, 1fr)) instead of CSS track-list text";
  }
  if (name === "backgroundImage" && /^linear-gradient\s*\(/iu.test(text)) {
    return "Use linearGradient(angle, start, end); for example linearGradient(90deg, color(\"red\"), color(\"blue\")) instead of gradient text";
  }
  if (!/\s/u.test(text)) return null;
  const tokens = text.split(/\s+/u);
  if (lookSpacingFamily.test(name) || lookSpacingProperties.has(name)) {
    return `Use 'spacing(${tokens.map(lookBuilderToken).join(", ")})'; Look multi-value shorthand is written with the spacing builder`;
  }
  if (lookBorderProperties.has(name)) {
    const call = lookBorderCall(tokens);
    return call
      ? `Use '${call}'; Look border shorthand is written with the border builder`
      : "Use the 'border(width, color, style)' builder; multi-part border strings bypass the checked Look system";
  }
  if (name === "boxShadow") {
    return "Use the 'shadow(x, y, blur, color)' builder; multi-part shadow strings bypass the checked Look system";
  }
  if (name === "transition") {
    const [property, duration, easing, delay] = tokens;
    const durations = /^[+-]?\d+(?:\.\d+)?(?:ms|s)$/u;
    if (property && duration && durations.test(duration) && tokens.length <= 4
      && (easing === undefined || /^[a-z-]+$/iu.test(easing))
      && (delay === undefined || durations.test(delay))) {
      const buildArguments = [`"${property}"`, duration, ...easing ? [`"${easing}"`] : [], ...delay ? [delay] : []];
      return `Use 'transition(${buildArguments.join(", ")})'; Look transition shorthand is written with the transition builder`;
    }
    return "Use the 'transition(property, duration, easing, delay)' builder; multi-part transition strings bypass the checked Look system";
  }
  return null;
}

/**
 * D104 rule 2 — what a refusal says when two entries in one scope write the
 * same CSS declaration. Written once because two positions raise it: a Look
 * block's entries and an element's `look:` directives lower to the same
 * one-rule-per-property stylesheet, so they have the same defect and deserve
 * the same sentence (D57 rule 134).
 *
 * The message leads with the mechanism, because the pair is legal CSS and the
 * author has every reason to expect source order to settle it. It does not
 * here: see LOOK_SHORTHAND_LONGHANDS for why the winner is decided module-wide.
 */
function lookShorthandOverlapMessage(shorthand: string, longhand: string, subject: string): string {
  const parts = lookShorthandParts(shorthand);
  return `${subject} sets '${shorthand}' and '${longhand}', and the shorthand writes the longhand. Look lowers every entry to its own CSS rule and orders those rules by where each property first appears in the module rather than by this block, so which of the two wins is not this code's to choose — an unrelated look elsewhere in the module decides it. Write ${parts.join(", ")} in place of '${shorthand}', or drop '${longhand}'`;
}

const lookCssWideKeywords = new Set(LOOK_CSS_WIDE_KEYWORDS);
const lookMetricKeywords = new Set([...lookCssWideKeywords, ...LOOK_SHARED_METRIC_KEYWORDS]);
/**
 * D73 rule 187: what a refusal says the property's *other* half is, so the
 * keyword list it goes on to print reads as the keyword half of a real value
 * space rather than as the whole of it.
 */
function lookVocabularyLead(kind: LookPropertyValueKind): string {
  switch (kind) {
    case "border": return "use the border(width, color, style) builder, or one of";
    case "shadow": return "use the shadow(x, y, blur, color) builder, or one of";
    case "angle": return "write an angle such as 45deg or 0.25turn, or one of";
    case "duration": return "write a duration such as 200ms or 0.3s, or one of";
    case "line-height": return "write a number or a length such as 1.5 or 24px, or one of";
    case "number": return "write a number, or one of";
    case "number-keyword": return "write a number, or one of";
    case "track": return "use the tracks(...) builder, or one of";
    case "transition": return "use the transition(property, duration, easing, delay) builder, or one of";
    default: return "write one of";
  }
}
const lookColorKeywords = new Set(LOOK_COLOR_KEYWORDS);

/**
 * D67 rule 174 — what a rejected Look string could have been.
 *
 * The message this replaces said "use one of the closed `name` keywords" and
 * stopped there, so the answer to "which ones?" lived only in the source of the
 * table. The evidence that this is not a hypothetical reader problem is that
 * the usage tour — written by someone who knew the design intent — shipped
 * twelve values no property had, and this diagnostic could not have told him.
 *
 * A near miss gets the one spelling meant, because naming the single correct
 * word is the strongest form of the promise. Otherwise a set small enough to
 * read is written out whole, and a larger one says what it holds. The CSS-wide
 * keywords join the search either way, so a misspelled `inherit` is caught the
 * same as a misspelled `groove`.
 */
function lookVocabularyGuidance(property: string, written: string, own: readonly string[], lead: string): LookValueGuidance {
  const vocabulary = [...new Set([...own, ...LOOK_CSS_WIDE_KEYWORDS])];
  const nearest = nearestLookName(written, vocabulary);
  if (nearest !== null) return { text: `did you mean '${nearest}'?`, named: true };
  const shape = LOOK_LARGE_KEYWORD_SETS.get(property);
  return {
    text: shape === undefined
      ? `${lead} ${vocabulary.join(", ")}`
      : `${lead} ${shape}, and none of them is spelled close to '${written}'`,
    named: false,
  };
}

interface LookValueGuidance {
  /** The clause that follows "does not accept 'value';". */
  readonly text: string;
  /**
   * Whether the clause named the one spelling the author meant. When it did,
   * the property's recorded exclusion is left off: the record answers "why is
   * my value not here?", and that question is not the one a misspelling asks.
   */
  readonly named: boolean;
}

/**
 * Every string this expression can be when it is written out of literals alone
 * — one literal, or a ternary whose branches are literals all the way down.
 * Answers null when a value is decided anywhere else, which is the signal that
 * a check reading it has nothing static to look at.
 */
function literalStringValues(expression: Expression): readonly string[] | null {
  if (expression.kind === "LiteralExpression") return typeof expression.value === "string" ? [expression.value] : [];
  if (expression.kind === "ConditionalExpression") {
    const thenValues = literalStringValues(expression.thenValue);
    const elseValues = literalStringValues(expression.elseValue);
    return thenValues && elseValues ? [...thenValues, ...elseValues] : null;
  }
  return null;
}

// WEB-S2: the attributes whose value the browser resolves as a URL and then
// navigates, fetches, or submits to. A `javascript:`/`vbscript:` string in one
// of them is script the page runs, which is the boundary the charter reserves
// for `unsafe:html` — so the scheme is checked wherever it is written down.
const WEB_URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "data", "xlink:href", "ping", "cite"]);
const WEB_SCRIPT_URL_SCHEMES = new Set(["javascript", "vbscript"]);
// A `data:` URL is a document the browser builds from the string itself, so it
// is inert only for the media types that cannot carry script. `image/svg+xml`
// is deliberately absent: an SVG document runs script.
const WEB_INERT_DATA_MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon",
  "video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
  "font/woff", "font/woff2", "font/ttf", "font/otf", "text/plain", "text/css",
]);

/**
 * The scheme a browser reads out of a URL string. Leading and embedded ASCII
 * whitespace and control characters are stripped first, because the URL parser
 * strips them too — `java\tscript:alert(1)` is a `javascript:` URL.
 */
function urlAttributeScheme(value: string): { readonly scheme: string; readonly rest: string } | null {
  const stripped = value.replace(/[\u0000-\u0020]/gu, "");
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(stripped);
  return match ? { scheme: match[1]!.toLowerCase(), rest: stripped.slice(match[0].length) } : null;
}

/** The clause naming why one literal URL is refused, or null when it is fine. */
function urlSchemeRefusal(value: string): string | null {
  const parsed = urlAttributeScheme(value);
  if (!parsed) return null;
  if (WEB_SCRIPT_URL_SCHEMES.has(parsed.scheme)) {
    return `'${parsed.scheme}:' is script, not a location — write an 'on:click' handler for behavior, or a real URL for navigation`;
  }
  if (parsed.scheme !== "data") return null;
  const media = (/^([^,;]*)/u.exec(parsed.rest)?.[1] ?? "").toLowerCase();
  if (WEB_INERT_DATA_MEDIA_TYPES.has(media)) return null;
  return `a 'data:' URL is only accepted for a media type that cannot carry script${media ? `, and '${media}' can` : ""}; the inert types are ${[...WEB_INERT_DATA_MEDIA_TYPES].join(", ")}`;
}

function isViewportComparison(expression: Expression): boolean {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return false;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return false;
  if (expression.left.property !== "width" && expression.left.property !== "height") return false;
  return true;
}

// LOK-I2: '720px >= viewport.width' means the same breakpoint as
// 'viewport.width <= 720px', but only the viewport-on-the-left spelling lowers
// to a media query. The flipped spelling is recognized so it teaches the
// supported order instead of reporting the subject as an unknown name.
const flippedComparisons: ReadonlyMap<string, string> = new Map([["<", ">"], ["<=", ">="], [">", "<"], [">=", "<="]]);

function flippedViewportComparison(expression: Expression): { readonly property: string; readonly operator: string; readonly threshold: Expression } | null {
  if (expression.kind !== "BinaryExpression" || !flippedComparisons.has(expression.operator)) return null;
  const subject = mediaSubjectShape(expression.right);
  if (subject?.subject !== "viewport" || (subject.feature !== "width" && subject.feature !== "height")) return null;
  return { property: subject.feature, operator: flippedComparisons.get(expression.operator)!, threshold: expression.left };
}

// 'scheme.dark'/'scheme.light' and 'motion.reduced' are Look condition subjects
// that lower to prefers-color-scheme and prefers-reduced-motion media queries,
// mirroring the viewport.* media atoms.
function isSchemeCondition(expression: Expression): boolean {
  if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return false;
  const subject = expression.object.name;
  if (subject === "viewport") return false;
  return (LOOK_MEDIA_SUBJECTS.get(subject)?.has(expression.property)) ?? false;
}

/** The subject name of a `subject.feature` shape, whether or not it is a Look subject. */
function mediaSubjectShape(expression: Expression): { readonly subject: string; readonly feature: string } | null {
  if (expression.kind !== "MemberExpression" || expression.optional || expression.object.kind !== "IdentifierExpression") return null;
  return { subject: expression.object.name, feature: expression.property };
}

function lookMediaVocabulary(): string {
  return [...LOOK_MEDIA_SUBJECTS].flatMap(([subject, features]) => [...features].map((feature) => `${subject}.${feature}`)).join(", ");
}

/** A readable rendering of a breakpoint threshold for diagnostic guidance. */
function lookSourceOf(expression: Expression): string {
  if (isWebUnit(expression)) return expression.raw;
  if (expression.kind === "IdentifierExpression") return expression.name;
  if (expression.kind === "LiteralExpression") return expression.raw;
  if (expression.kind === "MemberExpression") return `${lookSourceOf(expression.object)}.${expression.property}`;
  return "breakpoint";
}

/**
 * A syntactic rendering of one condition operand, used for the part of a Look
 * condition that does not lower to a selector or a media query: a runtime term
 * keeps its own scope, because two different runtime conditions really are two
 * different scopes.
 */
function lookRuntimeSignature(expression: Expression): string {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") return `@${expression.name}`;
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return `!(${lookRuntimeSignature(expression.operand)})`;
  if (expression.kind === "BinaryExpression") return `(${lookRuntimeSignature(expression.left)}${expression.operator}${lookRuntimeSignature(expression.right)})`;
  if (expression.kind === "MemberExpression") return `${lookRuntimeSignature(expression.object)}.${expression.property}`;
  if (expression.kind === "IdentifierExpression") return `id:${expression.name}`;
  if (isWebUnit(expression)) return `${expression.value}${expression.unit}`;
  if (expression.kind === "LiteralExpression") return `lit:${expression.raw}`;
  return `span:${expression.span.start}`;
}

function lookKebab(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

const lookOperatorNames: ReadonlyMap<string, string> = new Map([["<", "lt"], ["<=", "lte"], [">", "gt"], [">=", "gte"]]);
const lookNegatedOperators: ReadonlyMap<string, string> = new Map([["<", ">="], ["<=", ">"], [">", "<="], [">=", "<"]]);

/**
 * LOK-I5: the duplicate-property scope used to key on the *written* condition,
 * while the emitter keys its rules on the *lowered* one. `if scheme.dark:` and
 * `if not scheme.light:` are the same condition by the charter's own words, so
 * one silently overwrote the other and the loser was never reported. These
 * atoms mirror the emitter's lowering exactly — a scheme and a reduced-motion
 * negation name the other side of the query, and a negated breakpoint flips its
 * operator — so the scope key is the token the rule ends up carrying.
 */
function lookConditionAtom(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): string | null {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
    return `${negated ? "not-" : ""}${lookKebab(expression.name)}`;
  }
  if (expression.kind === "MemberExpression" && expression.object.kind === "IdentifierExpression") {
    if (expression.object.name === "motion") {
      return expression.property === "reduced" ? `motion-${negated ? "no-preference" : "reduce"}` : null;
    }
    if (expression.object.name === "scheme" && (expression.property === "dark" || expression.property === "light")) {
      return `scheme-${negated ? (expression.property === "dark" ? "light" : "dark") : expression.property}`;
    }
    return null;
  }
  if (!isViewportComparison(expression)) return null;
  const comparison = expression as Extract<Expression, { kind: "BinaryExpression" }>;
  const threshold = evaluateLookStaticExpression(comparison.right, staticValues);
  if (threshold?.kind !== "unit" || !LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) return null;
  const property = (comparison.left as Extract<Expression, { kind: "MemberExpression" }>).property;
  const operator = negated ? lookNegatedOperators.get(comparison.operator)! : comparison.operator;
  return `viewport-${property}-${lookOperatorNames.get(operator)!}-${lookStaticCss(threshold)!}`;
}

/**
 * One Look condition as the set of alternatives it lowers to, each alternative
 * being the sorted atoms that must hold together. Two conditions share a
 * duplicate-detection scope exactly when this rendering matches, so a condition
 * written the other way round, negated into its complement, or spelled with its
 * operands swapped lands in the scope its rule will actually occupy.
 */
function lookConditionKey(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): string {
  const terms = lookConditionTerms(expression, negated, staticValues);
  return terms.map((term) => [...term].sort().join("+")).sort().join("|");
}

function lookConditionTerms(
  expression: Expression,
  negated: boolean,
  staticValues: ReadonlyMap<string, LookStaticValue>,
): readonly (readonly string[])[] {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") {
    return lookConditionTerms(expression.operand, !negated, staticValues);
  }
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTerms(expression.left, negated, staticValues);
    const right = lookConditionTerms(expression.right, negated, staticValues);
    if (!conjunction) return [...left, ...right].slice(0, LOOK_CONDITION_TERM_LIMIT);
    const combined: (readonly string[])[] = [];
    for (const first of left) {
      for (const second of right) {
        combined.push([...first, ...second]);
        if (combined.length >= LOOK_CONDITION_TERM_LIMIT) return combined;
      }
    }
    return combined;
  }
  const atom = lookConditionAtom(expression, negated, staticValues);
  return [[atom ?? `rt:${negated ? "!" : ""}${lookRuntimeSignature(expression)}`]];
}

/**
 * Every name in a module or component body whose read is reactive but whose
 * binding is not itself a state/prop reference: a computed accessor, a resource
 * handle, an action handle. A Look literal that reads one of these freezes it
 * exactly as it freezes a state read (LOK-D1).
 *
 * The retired `computed(...)` accessor stays in the callee test even though it
 * is not a global any more (D71 replaced it with the declaration): analysis
 * after a migration diagnostic still has to stay coherent, so the name a
 * retired declaration binds is treated as derived exactly as it was before.
 */
function collectDerivedReactiveNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration" && statement.pattern.kind === "NameBindingPattern"
        && statement.initializer.kind === "CallExpression" && statement.initializer.callee.kind === "IdentifierExpression"
        && isRetiredAccessorName(statement.initializer.callee.name)) {
        names.add(statement.pattern.name);
        continue;
      }
      if (!isWebStatement(statement)) continue;
      if (statement.kind === "ExtensionStatement:web:resource" || statement.kind === "ExtensionStatement:web:action") names.add(statement.name);
      if (statement.kind === "ExtensionStatement:web:component") record(statement.body as readonly Statement[]);
    }
  };
  record(program.body);
  return names;
}

/**
 * Every `const name = look:` in the module, wherever it is written. A name
 * declared twice maps to null: two different Look literals under one name make
 * the composition question unanswerable, so the check that reads this map
 * declines rather than guessing which one an element received.
 */
function collectLookDeclarations(program: Program): ReadonlyMap<string, WebLookExpression | null> {
  const looks = new Map<string, WebLookExpression | null>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "VariableDeclaration") {
      const declaration = record as unknown as Extract<Statement, { kind: "VariableDeclaration" }>;
      if (declaration.binding === "const" && declaration.pattern.kind === "NameBindingPattern" && isWebLook(declaration.initializer)) {
        looks.set(declaration.pattern.name, looks.has(declaration.pattern.name) ? null : declaration.initializer);
      }
    }
    for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
  };
  visit(program.body);
  return looks;
}

/**
 * The properties one Look sets, each keyed by the target it sets them on so a
 * `@before:` colour and an element colour stay two different decisions. The
 * condition is deliberately not part of the key: two looks that set one
 * property under conditions that can both hold are exactly the ambiguity this
 * serves. A `...spread` of another look is followed, and the names followed are
 * reported back, because composing is what makes two looks ordered rather than
 * independent.
 */
function lookContributions(
  look: WebLookExpression,
  looks: ReadonlyMap<string, WebLookExpression | null>,
  visited: ReadonlySet<string> = new Set(),
): { readonly properties: ReadonlySet<string>; readonly composed: ReadonlySet<string> } {
  const properties = new Set<string>();
  const composed = new Set<string>();
  const walk = (entries: WebLookExpression["entries"], target: string): void => {
    for (const entry of entries) {
      if (entry.kind === "LookProperty") properties.add(`${target}:${entry.name}`);
      else if (entry.kind === "LookIf") {
        walk(entry.thenEntries, target);
        walk(entry.elseEntries, target);
      } else if (entry.kind === "LookTarget") walk(entry.entries, entry.name);
      else if (entry.kind === "LookSpread" && entry.value.kind === "IdentifierExpression" && !visited.has(entry.value.name)) {
        const source = looks.get(entry.value.name);
        composed.add(entry.value.name);
        if (!source) continue;
        const inner = lookContributions(source, looks, new Set([...visited, entry.value.name]));
        for (const property of inner.properties) properties.add(property);
        for (const name of inner.composed) composed.add(name);
      }
    }
  };
  walk(look.entries, "");
  return { properties, composed };
}

/**
 * D103: where one Look value was written — which property it sets, the span of
 * the whole entry, and the directive spelling if it is one. A migration needs
 * all three, because a `look:property="text"` attribute and a
 * `property = "text"` block entry are rewritten differently.
 */
interface LookValueSite {
  readonly property: string;
  readonly entrySpan: Span;
  readonly directive: "look" | "style" | null;
}

/**
 * D103: where a migration writes a `velar/look` import. `declaration` is the
 * module's existing import of that module when it has one, so the rewrite grows
 * that line rather than adding a second import of the same module; `insertAt`
 * is where a first one goes otherwise — after the last import, or before the
 * first statement of a module with none.
 */
interface LookImportSite {
  readonly declaration: { readonly span: Span; readonly specifiers: readonly { readonly imported: string; readonly local: string }[] } | null;
  readonly insertAt: number;
  readonly leadingBlankLine: boolean;
}

function collectLookImportSite(program: Program): LookImportSite {
  let lastImportEnd: number | null = null;
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration") continue;
    lastImportEnd = statement.span.end;
    if (statement.source !== "velar/look" || statement.javascript || statement.specifiers.some((specifier) => specifier.namespace)) continue;
    return {
      declaration: {
        span: statement.span,
        specifiers: statement.specifiers.map((specifier) => ({ imported: specifier.imported, local: specifier.local })),
      },
      insertAt: statement.span.end,
      leadingBlankLine: false,
    };
  }
  return lastImportEnd === null
    ? { declaration: null, insertAt: program.body[0]?.span.start ?? 0, leadingBlankLine: true }
    : { declaration: null, insertAt: lastImportEnd, leadingBlankLine: false };
}

/** Local names bound to a velar/look builder, including aliased imports. */
function collectLookBuilderNames(program: Program): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.kind !== "ImportDeclaration" || statement.source !== "velar/look" || statement.javascript) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.namespace || !LOOK_BUILDERS.has(specifier.imported)) continue;
      names.set(specifier.local, specifier.imported);
    }
  }
  return names;
}

function lookConditionTermCount(expression: Expression, negated = false): number {
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return lookConditionTermCount(expression.operand, !negated);
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    const conjunction = (expression.operator === "and") !== negated;
    const left = lookConditionTermCount(expression.left, negated);
    const right = lookConditionTermCount(expression.right, negated);
    const total = conjunction ? left * right : left + right;
    return Math.min(LOOK_CONDITION_TERM_LIMIT + 1, total);
  }
  return 1;
}

function firstRelativeCssAssetAddress(source: string): { readonly value: string; readonly syntax: string } | null {
  for (const token of cssTokens(source)) {
    if (token.kind !== "url" && token.kind !== "asset-address") continue;
    // A URL parser drops leading and trailing spaces, and an empty url() names
    // the document itself rather than an asset.
    const value = token.value.trim();
    if (value === "") continue;
    if (value.startsWith("/") || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(value)) continue;
    return { value, syntax: token.kind === "url" ? "url" : token.syntax };
  }
  return null;
}

function isLookNumericType(type: ValueType): boolean {
  return type.kind === "named" && LOOK_NUMERIC_TYPE_NAMES.has(type.name);
}

/** True when a property's declared domain includes a spelled visual unit type. */
function mentionsLookUnitType(type: ValueType): boolean {
  if (type.kind === "named") return LOOK_NUMERIC_TYPE_NAMES.has(type.name) || type.name === "Spacing" || type.name === "TrackList" || type.name === "Track";
  if (type.kind === "union") return type.members.some(mentionsLookUnitType);
  if (type.kind === "optional") return mentionsLookUnitType(type.inner);
  return false;
}

function lookLiteralZero(expression: Expression): boolean {
  if (expression.kind === "LiteralExpression") return expression.value === 0;
  if (expression.kind === "UnaryExpression" && (expression.operator === "-" || expression.operator === "+")) return lookLiteralZero(expression.operand);
  return isWebUnit(expression) && expression.value === 0;
}

function lookAdditiveType(left: ValueType, right: ValueType): ValueType | null {
  if (!isLookNumericType(left) || !isLookNumericType(right)) return null;
  if (semanticTypeIdentity(left) === semanticTypeIdentity(right)) return left;
  const lengthPercentageNames = new Set(["Length", "Percentage", "LengthPercentage"]);
  if (left.kind === "named" && right.kind === "named"
    && lengthPercentageNames.has(left.name) && lengthPercentageNames.has(right.name)) return lookLengthPercentage;
  return null;
}

function containsCssImport(source: string): boolean {
  for (const token of cssTokens(source)) {
    if (token.kind === "at-keyword" && token.name.toLowerCase() === "import") return true;
  }
  return false;
}

function checkRouteComponent(type: ValueType, sourceSpan: Span, subject: string, context: CompilerIntrinsicAnalysisContext): void {
  if (isInvalidType(type)) return;
  if (!isWebComponentType(type)) {
    if (type.kind !== "any") context.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
    return;
  }
  const unsupported = [...type.requiredProperties].filter((name) => name !== "route");
  if (unsupported.length > 0) context.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
  const routeProp = type.properties.get("route");
  if (routeProp && !context.isAssignable({ kind: "named", name: "RouteContext", identity: routeContextIdentity }, routeProp)) context.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
}

function checkRoutePath(path: string, sourceSpan: Span, report: (message: string, span: Span) => void): void {
  if (!path.startsWith("/")) report("A route path must start with '/'", sourceSpan);
  if (path.includes("?") || path.includes("#")) report("A route path describes only a pathname; read query and hash from RouteContext", sourceSpan);
  if (path.includes("\\")) report("A route path cannot contain a backslash", sourceSpan);
  if (path.length > 1 && path.endsWith("/")) report("A route path cannot end with '/'; matching already accepts one trailing slash", sourceSpan);
  const segments = path.split("/").slice(1);
  const parameters = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0 && path !== "/") report("A route path cannot contain an empty segment", sourceSpan);
    if (segment === "*") {
      if (index !== segments.length - 1) report("A route wildcard must be the final segment", sourceSpan);
      if (parameters.has("wildcard")) report("A route parameter named 'wildcard' conflicts with the '*' capture", sourceSpan);
      parameters.add("wildcard");
      continue;
    }
    if (segment.includes("*")) report("A route wildcard must occupy its whole final segment", sourceSpan);
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) report("A route parameter requires a valid name", sourceSpan);
    else if (parameters.has(name)) report(`Route parameter '${name}' is repeated`, sourceSpan);
    parameters.add(name);
  }
}

function containsPromise(type: ValueType): boolean {
  if (type.kind === "promise") return true;
  if (type.kind === "optional") return containsPromise(type.inner);
  if (type.kind === "list" || type.kind === "set") return containsPromise(type.element);
  if (type.kind === "map") return containsPromise(type.key) || containsPromise(type.value);
  if (type.kind === "record") return containsPromise(type.value);
  if (type.kind === "union") return type.members.some(containsPromise);
  return false;
}


function hasAccessibleJsxContent(expression: JSXElementExpression): boolean {
  return expression.children.some((child) => {
    if (child.kind === "JSXText") return child.value.trim().length > 0;
    if (child.kind === "JSXExpressionChild") return true;
    return hasAccessibleJsxContent(child) || child.tag.length > 0;
  });
}

function hasAccessibleSvgName(expression: JSXElementExpression): boolean {
  const named = expression.attributes.some((attribute) => {
    if (attribute.name !== "aria-label" && attribute.name !== "aria-labelledby") return false;
    if (attribute.value === null) return false;
    return typeof attribute.value !== "string" || attribute.value.trim().length > 0;
  });
  if (named) return true;
  const hidden = expression.attributes.find((attribute) => attribute.name === "aria-hidden");
  if (hidden?.value === "true" || (hidden?.value && typeof hidden.value !== "string"
    && hidden.value.kind === "LiteralExpression" && hidden.value.value === true)) return true;
  return expression.children.some((child) => child.kind === "ExtensionExpression:web:jsx"
    && child.tag === "title" && hasAccessibleJsxContent(child));
}

/**
 * `computed(...)` the function is answered with the signature it always had, so
 * a call written around it still type-checks instead of collapsing into an
 * unknown one — that is what keeps the one message about the declaration form
 * the only thing the author reads. `reactive.computed` itself is gone; this one
 * derives no reactivity and is never emitted, because every site that produces
 * it also produces an error. It stays an intrinsic only so the reader it
 * returns carries the callback's own result: an annotated declaration —
 * `const one: () -> number = computed(() => 1)` — would otherwise read a
 * second, spurious assignability error on top of it.
 */
const RETIRED_ACCESSOR_INTRINSIC = "reactive.retired-accessor";
const retiredAccessorReaderType: ValueType = Object.freeze({ kind: "function", parameters: [], requiredParameters: 0, result: unknownType });
const RETIRED_ACCESSOR_TYPE: ValueType = Object.freeze({
  kind: "intrinsic",
  name: RETIRED_ACCESSOR_INTRINSIC,
  parameterNames: ["read"],
  parameters: [retiredAccessorReaderType],
  requiredParameters: 1,
  result: retiredAccessorReaderType,
});

/** The function spelling of a derived value; `computed` the declaration is what it becomes. */
function isRetiredAccessorName(name: string): boolean {
  return name === "computed";
}

/**
 * D90 R15(a): a watch subject names a place in the reactive graph — the name of
 * a `state` or a `computed`, or a read path out of one — and never computes a
 * value. The rule is written positively, as this allowlist, because that is
 * what makes the relation between a watch and its source *declared* rather than
 * inferred; every earlier attempt to infer it was defeated by one more
 * indirection. A path is legal at any depth and with any index expression:
 * `rows[i].cells[j]` still selects a place, and whether `i` is a constant or
 * another state changes nothing about that. An operator or a call derives a new
 * value instead, and a derived value already has a spelling that names it,
 * caches it, and declares its dependencies. The conditional is an operator by
 * the charter's own vocabulary, and an f-string builds a new string, so neither
 * needs a clause of its own — they simply are not paths.
 *
 * Whether the root of a legal path is reactive is a different question, and
 * `frozenWatchSubject` keeps it: this answers shape only.
 */
function watchSubjectPath(expression: Expression): boolean {
  switch (expression.kind) {
    case "IdentifierExpression":
      return true;
    case "MemberExpression":
    case "IndexExpression":
      return watchSubjectPath(expression.object);
    default:
      return false;
  }
}

/** The escapes a text literal carries back into source (`scanStringEscape`). */
const WATCH_SUBJECT_TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  "\"": "\\\"",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * A text literal written back as source. `LiteralExpression.raw` holds the
 * decoded content without its quotes, so echoing it would quote an expression
 * the author never wrote and hand him a `computed` line that does not compile —
 * `watch term + "!":` would read back as `term + !`. The quote the author chose
 * is not on the node, so every text literal reads back double-quoted; that is a
 * spelling difference, not a meaning one, and it compiles.
 */
function renderWatchTextLiteral(value: string, insideFString: boolean): string {
  let text = "";
  for (const character of value) {
    const escape = WATCH_SUBJECT_TEXT_ESCAPES[character];
    if (escape !== undefined) {
      text += escape;
      continue;
    }
    // `{{` and `}}` are how an f-string carries a brace that is not a hole.
    if (insideFString && (character === "{" || character === "}")) {
      text += `${character}${character}`;
      continue;
    }
    const code = character.codePointAt(0)!;
    text += code < 0x20 || code === 0x7f ? `\\u{${code.toString(16)}}` : character;
  }
  return text;
}

/**
 * The subject as the author wrote it, reconstructed from the AST for exactly
 * the node kinds a subject can be. The analyzer never sees the module text, and
 * a refusal that cannot quote what it refused teaches nothing — so the message
 * quotes this. It is a reconstruction and stays one: it is used in the message
 * only, never in a `fix`, because rewriting an author's source from a
 * reconstruction is a worse defect than the one being reported. Null means
 * "cannot say faithfully", and the message drops the echo rather than guess.
 *
 * Faithfulness is the whole point, so grouping is carried across rather than
 * re-derived: the three nodes that record the author's own parentheses are
 * printed with them, and the low-precedence nodes that record nothing are
 * parenthesized wherever a bare printing would re-associate. The reconstruction
 * therefore parses back to the tree it came from.
 */
function renderWatchSubject(expression: Expression): string | null {
  switch (expression.kind) {
    case "IdentifierExpression":
      return expression.name;
    case "LiteralExpression":
      return typeof expression.value === "string" ? `"${renderWatchTextLiteral(expression.value, false)}"` : expression.raw;
    case "MemberExpression": {
      const object = renderWatchSubjectOperand(expression.object);
      return object === null ? null : `${object}${expression.optional ? "?." : "."}${expression.property}`;
    }
    case "IndexExpression": {
      const object = renderWatchSubjectOperand(expression.object);
      const index = renderWatchSubject(expression.index);
      return object === null || index === null ? null : `${object}${expression.optional ? "?" : ""}[${index}]`;
    }
    case "CallExpression": {
      const callee = renderWatchSubjectOperand(expression.callee);
      if (callee === null) return null;
      const argumentTexts: string[] = [];
      for (const [index, argument] of expression.arguments.entries()) {
        const rendered = renderWatchSubject(argument);
        if (rendered === null) return null;
        const name = expression.argumentNames?.[index] ?? null;
        argumentTexts.push(name === null ? rendered : `${name} = ${rendered}`);
      }
      return `${callee}${expression.optional ? "?" : ""}(${argumentTexts.join(", ")})`;
    }
    case "SpreadExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `...${value}`;
    }
    case "RequiredExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `${value}!`;
    }
    case "TryExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      return value === null ? null : `try ${value}`;
    }
    case "ListExpression": {
      const elements = expression.elements.map((element) => renderWatchSubject(element));
      if (elements.some((element) => element === null)) return null;
      return `[${elements.join(", ")}]`;
    }
    case "ObjectExpression": {
      const entries: string[] = [];
      for (const property of expression.properties) {
        if (property.kind === "ObjectSpread") {
          const value = renderWatchSubjectOperand(property.value);
          if (value === null) return null;
          entries.push(`...${value}`);
          continue;
        }
        if (property.shorthand === true) {
          entries.push(property.name);
          continue;
        }
        const value = renderWatchSubject(property.value);
        if (value === null) return null;
        entries.push(`${property.name}: ${value}`);
      }
      return `{${entries.join(", ")}}`;
    }
    case "ArrowFunctionExpression": {
      // An annotated or defaulted parameter would need a type printer this file
      // has no business owning; the callback shapes a subject carries do not.
      if (expression.parameters.some((parameter) => parameter.type !== null || parameter.defaultValue !== null)) return null;
      const body = renderWatchSubject(expression.body);
      if (body === null) return null;
      const parameters = expression.parameters.map((parameter) => `${parameter.rest ? "..." : ""}${parameter.name}`);
      const head = expression.parameters.length === 1 && !expression.parameters[0]!.rest
        ? parameters[0]!
        : `(${parameters.join(", ")})`;
      return `${expression.asynchronous ? "async " : ""}${head} => ${body}`;
    }
    case "UnaryExpression": {
      const operand = renderWatchSubjectOperand(expression.operand);
      if (operand === null) return null;
      const spaced = expression.operator === "not" || expression.operator === "await";
      return `${expression.operator}${spaced ? " " : ""}${operand}`;
    }
    case "BinaryExpression": {
      const left = renderWatchSubjectOperand(expression.left);
      const right = renderWatchSubjectOperand(expression.right);
      if (left === null || right === null) return null;
      return groupWatchSubject(`${left} ${expression.operator} ${right}`, expression.parenthesized);
    }
    case "ComparisonChainExpression": {
      const operands = expression.operands.map((operand) => renderWatchSubjectOperand(operand));
      const first = operands[0];
      if (first === undefined || first === null || operands.some((operand) => operand === null)) return null;
      const chain = operands.slice(1).reduce<string>((text, operand, index) => `${text} ${expression.operators[index]} ${operand}`, first);
      return groupWatchSubject(chain, expression.parenthesized);
    }
    case "ConditionalExpression": {
      const condition = renderWatchSubjectOperand(expression.condition);
      const thenValue = renderWatchSubjectOperand(expression.thenValue);
      const elseValue = renderWatchSubject(expression.elseValue);
      if (condition === null || thenValue === null || elseValue === null) return null;
      return `${condition} ? ${thenValue} : ${elseValue}`;
    }
    case "IsExpression": {
      const value = renderWatchSubjectOperand(expression.value);
      // Only a plain named type reads back as one word; anything generic or
      // optional would need a type printer this file has no business owning.
      if (value === null || expression.type.syntax.kind !== "NamedTypeSyntax") return null;
      return groupWatchSubject(`${value} ${expression.operator} ${expression.type.syntax.name}`, expression.parenthesized);
    }
    case "FStringExpression": {
      let text = "";
      for (const part of expression.parts) {
        if (part.kind === "text") {
          text += renderWatchTextLiteral(part.value, true);
          continue;
        }
        const value = renderWatchSubject(part.value);
        if (value === null) return null;
        text += `{${value}}`;
      }
      return `f"${text}"`;
    }
    default:
      return null;
  }
}

/**
 * The same reconstruction in a position where a bare printing would bind
 * differently than the author's source did — a binary operand, the object of a
 * member read, the callee of a call. A conditional or an arrow reaches such a
 * position only through parentheses the author wrote, and neither node records
 * them, so they are restored here.
 */
function renderWatchSubjectOperand(expression: Expression): string | null {
  const rendered = renderWatchSubject(expression);
  if (rendered === null) return null;
  return expression.kind === "ConditionalExpression" || expression.kind === "ArrowFunctionExpression"
    ? `(${rendered})`
    : rendered;
}

/** Restores the parentheses the author wrote, for the three nodes that record them. */
function groupWatchSubject(rendered: string, parenthesized: true | undefined): string {
  return parenthesized === true ? `(${rendered})` : rendered;
}

interface RetiredAccessorDeclaration {
  readonly name: string;
  readonly exported: boolean;
  /** The named function the argument reads through, when it is one — `computed(readA)`. */
  readonly readName: string | null;
  readonly declarationSpan: Span;
  readonly callSpan: Span;
  /** The `() => E` body span, or null when the argument is not that shape. */
  readonly bodySpan: Span | null;
}

/**
 * D89 A4: what a `map` callback rebuilds, when it returns a newly built record
 * instead of the row it was handed. Null is the non-trigger answer the ruling
 * names — a callback that returns its parameter, or anything else that is not a
 * record literal, builds nothing and moves no identity. A record is reported
 * even when no field can be named, because it is the rebuilt row's own identity
 * that the keyed list stops recognising, not any one field it carries.
 *
 * A conditional is read through because the React spelling nearly always
 * carries one, `t.id == id ? {...t, done: true} : t`, and its `else` branch is
 * the returns-the-original case rather than a second shape. A branch that names
 * a field is preferred, since a suggestion that names one is the whole product.
 */
function keyedRebuiltRecord(body: Expression, row: string): { readonly field: string | null } | null {
  if (body.kind === "ObjectExpression") {
    // `{ id: item.id, done: true }` copies the key across and rewrites `done`.
    // Naming `id` would send the author to write the one field whose value the
    // keyed list reads, so a field that only carries the row's own value over
    // is not the field the message is about.
    for (const property of body.properties) {
      if (property.kind !== "ObjectProperty") continue;
      if (rowFieldPassthrough(property.value, row, property.name)) continue;
      return { field: property.name };
    }
    // A pure `{...item}` rewrites no field at all; the copy itself is what
    // moves the row's identity, so there is no field name for the message.
    return body.properties.length > 0 ? { field: null } : null;
  }
  if (body.kind === "ConditionalExpression") {
    const thenSide = keyedRebuiltRecord(body.thenValue, row);
    const elseSide = keyedRebuiltRecord(body.elseValue, row);
    if (thenSide?.field) return thenSide;
    if (elseSide?.field) return elseSide;
    return thenSide ?? elseSide;
  }
  return null;
}

type FunctionDeclarationStatement = Extract<Statement, { readonly kind: "FunctionDeclaration" }>;

/**
 * D89 A4, the wider proven shape: every `def` of the module by name, so a
 * `computed` whose initializer calls one can be read through to what that call
 * builds. A name declared twice maps to null — two bodies under one name make
 * the question unanswerable, and an advisory that cannot prove which body runs
 * stays silent rather than guessing.
 */
function collectModuleFunctions(program: Program): ReadonlyMap<string, FunctionDeclarationStatement | null> {
  const functions = new Map<string, FunctionDeclarationStatement | null>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "FunctionDeclaration") {
        functions.set(statement.name, functions.has(statement.name) ? null : statement);
        record(statement.body);
        continue;
      }
      if (isWebStatement(statement) && statement.kind === "ExtensionStatement:web:component") {
        record(statement.body as readonly Statement[]);
      }
    }
  };
  record(program.body);
  return functions;
}

type LoopBindingPattern = Extract<Statement, { readonly kind: "ForStatement" }>["pattern"];

/** Every name a binding pattern introduces, added to `names`. */
function collectPatternNames(pattern: LoopBindingPattern, names: Set<string>): void {
  if (pattern.kind === "NameBindingPattern") {
    names.add(pattern.name);
    return;
  }
  if (pattern.kind === "ListBindingPattern") {
    for (const element of pattern.elements) if (element) collectPatternNames(element, names);
  } else {
    for (const entry of pattern.entries) collectPatternNames(entry.pattern, names);
  }
  if (pattern.rest) names.add(pattern.rest.name);
}

/** True when the expression reads one of `names` anywhere inside it. */
function readsAnyName(value: unknown, names: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => readsAnyName(item, names));
  const record = value as Record<string, unknown>;
  if (record.kind === "IdentifierExpression" && typeof record.name === "string" && names.has(record.name)) return true;
  return Object.values(record).some((child) => readsAnyName(child, names));
}

/**
 * D89 A4, the wider proven shape: whether a `def` answers a list it filled with
 * freshly constructed records — the `for`/`append` builder that spells the same
 * churn `list = list.map(item => {…})` spells with `map`, and the spelling the
 * P2b consumer actually wrote.
 *
 * Four things are proven, and any one of them missing leaves the advisory
 * silent, because the whole product is naming a rebuild that really happens:
 *
 * 1. the body's last statement returns a name it declared here, initialized to
 *    an empty list literal — so the list is the `def`'s own, not one handed in;
 * 2. every value appended to that list is a record literal, so every element is
 *    a new value on every call. One `append(row)` of a source record is the
 *    identity-preserving spelling this advisory teaches, and one member call
 *    the proof cannot read leaves the whole answer unproven;
 * 3. at least one such record reads a parameter of the `def` or the binding of
 *    the `for` that appends it. A builder whose records are constant answers
 *    the same content every call, so nothing it is derived from can move and
 *    the `computed` over it never recomputes;
 * 4. nothing else touches the list — it is built and answered, nothing more.
 */
function buildsFreshRecords(declaration: FunctionDeclarationStatement): boolean {
  const returned = declaration.body.at(-1);
  if (!returned || returned.kind !== "ReturnStatement" || returned.value?.kind !== "IdentifierExpression") return false;
  const built = returned.value.name;
  const local = declaration.body.find((statement) => statement.kind === "VariableDeclaration"
    && statement.pattern.kind === "NameBindingPattern" && statement.pattern.name === built);
  if (!local || local.kind !== "VariableDeclaration") return false;
  if (local.initializer.kind !== "ListExpression" || local.initializer.elements.length > 0) return false;

  const parameters = new Set(declaration.parameters.map((parameter) => parameter.name));
  let records = 0;
  let varying = false;
  let unproven = false;
  const walk = (statements: readonly Statement[], visible: ReadonlySet<string>): void => {
    for (const statement of statements) {
      if (statement.kind === "ForStatement") {
        const inner = new Set(visible);
        collectPatternNames(statement.pattern, inner);
        if (statement.secondPattern) collectPatternNames(statement.secondPattern, inner);
        walk(statement.body, inner);
        continue;
      }
      if (statement.kind === "IfStatement") {
        walk(statement.thenBody, visible);
        walk(statement.elseBody ?? [], visible);
        continue;
      }
      if (statement.kind === "WhileStatement") {
        walk(statement.body, visible);
        continue;
      }
      if (statement.kind !== "ExpressionStatement") continue;
      const call = statement.expression;
      if (call.kind !== "CallExpression" || call.callee.kind !== "MemberExpression") continue;
      if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== built) continue;
      const [appended] = call.arguments;
      if (call.callee.property !== "append" || !appended || appended.kind !== "ObjectExpression") {
        unproven = true;
        continue;
      }
      records += 1;
      if (readsAnyName(appended, visible)) varying = true;
    }
  };
  walk(declaration.body, parameters);
  return !unproven && records > 0 && varying;
}

/**
 * The reactive declarations a `def` body may not hold when the `def` answers
 * `WebNode`. `watch`, `resource` and `action` are already refused outside a
 * module or component scope (VEL3010/VEL3012/VEL3013); they stay listed because
 * the defect is the declaration, not which of them the author reached for.
 */
const WEB_REACTIVE_DECLARATION_LABELS: ReadonlyMap<string, string> = new Map([
  ["ExtensionStatement:web:state", "'state'"],
  ["ExtensionStatement:web:computed", "'computed'"],
  ["ExtensionStatement:web:resource", "'resource'"],
  ["ExtensionStatement:web:watch", "'watch'"],
  ["ExtensionStatement:web:mounted", "'@mounted'"],
  ["ExtensionStatement:web:cleanup", "'@cleanup'"],
]);

/**
 * The first reactive declaration a body holds, in source order. A nested `def`
 * or `component` owns its own declarations, so the walk stops at one.
 */
function firstReactiveDeclaration(body: readonly Statement[]): { readonly label: string; readonly span: Span } | null {
  let found: { readonly label: string; readonly span: Span } | null = null;
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    const label = kind === null ? undefined : WEB_REACTIVE_DECLARATION_LABELS.get(kind);
    if (label !== undefined) {
      const span = node.span as Span;
      if (found === null || span.start < found.span.start) found = { label, span };
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return found;
}

/**
 * Whether a type answers markup. `WebNode` is the value, and `WebNode?` and
 * `List<WebNode>` are the two shapes markup legitimately travels in — a helper
 * that answers "this row, or nothing" and one that answers a row per item.
 * Reading only the bare annotation closed the spelling instead of the sink:
 * the identical body under `-> WebNode?` reached the same defect unreported.
 */
function carriesWebNode(type: ValueType): boolean {
  if (isWebNodeType(type)) return true;
  if (type.kind === "optional") return carriesWebNode(type.inner);
  if (type.kind === "list") return carriesWebNode(type.element);
  return false;
}

/**
 * Whether a body's own `return`s carry JSX. A return type is optional on a
 * `def`, and an omitted one left the same defective helper unreported, so the
 * markup the body returns answers for the annotation that was never written.
 * A nested `def` or `component` owns its own returns, exactly as it owns its
 * own declarations.
 */
function bodyReturnsJsx(body: readonly Statement[]): boolean {
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    if (kind === "ReturnStatement") {
      if (subtreeHoldsJsx(node.value)) return true;
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return false;
}

/**
 * A returned expression that builds markup anywhere inside it — bare, inside a
 * List, behind a condition, or built by the callback of a `.map(...)` that
 * answers a row per item. The arrow is walked rather than skipped for the same
 * reason the optional and List annotations are unwrapped: `rows()` returning
 * `items.map(item => <li>…</li>)` is a markup helper by every measure except
 * the one spelling that was being read.
 */
function subtreeHoldsJsx(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (Array.isArray(entry)) {
      for (const item of entry) pending.push(item);
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    if (node.kind === "ExtensionExpression:web:jsx") return true;
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return false;
}

/**
 * VEL5075: the JSX elements a body's own `return`s *start* with — the roots of
 * the returned markup, which is where the emitter decides between an instance
 * and a child. The walk descends through ordinary expression nodes, `.map(...)`
 * callbacks included, and stops at the first JSX element on every path: inside
 * one, every JSX position is a child position and needs no verdict. A nested
 * `def` or `component` owns its own returns, exactly as it does elsewhere here.
 */
function returnedMarkupRoots(body: readonly Statement[]): readonly JSXElementExpression[] {
  const roots: JSXElementExpression[] = [];
  const collect = (value: unknown): void => {
    const pending: unknown[] = [value];
    while (pending.length > 0) {
      const entry = pending.pop();
      if (Array.isArray(entry)) {
        for (const item of entry) pending.push(item);
        continue;
      }
      if (entry === null || typeof entry !== "object") continue;
      const node = entry as Record<string, unknown>;
      if (node.kind === "ExtensionExpression:web:jsx") {
        roots.push(node as unknown as JSXElementExpression);
        continue;
      }
      for (const key of Object.keys(node)) pending.push(node[key]);
    }
  };
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    if (kind === "ReturnStatement") {
      collect(node.value);
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return roots;
}

/** The component spelling of a helper's name: components render as a PascalCase tag. */
function componentSpelling(name: string): string {
  return name.length === 0 ? name : `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

/** `{ id: item.id }` in a callback over `item`: the field carries its own value over unchanged. */
function rowFieldPassthrough(value: Expression, row: string, name: string): boolean {
  return value.kind === "MemberExpression" && value.property === name
    && value.object.kind === "IdentifierExpression" && value.object.name === row;
}

/**
 * D89 A4: one rebuild of a list's rows, held until the module's JSX is analyzed
 * so the advisory is raised only where that same list is what a keyed list
 * renders.
 *
 * `kind` names which spelling wrote it, and the two differ only in the remedy
 * the message ends with. An `assignment` — `list = list.map(item => {…})` — owns
 * the list it rewrote, so the preserving alternative is the field write next to
 * it. A `derived` rebuild is a `computed` that builds its rows, and a derived
 * value owns nothing it could write, so the alternative names the source rows
 * instead.
 */
interface KeyedListRebuild {
  readonly kind: "assignment" | "derived";
  readonly source: string;
  readonly name: string;
  /** The rewritten field, or null when the rebuild names none. */
  readonly field: string | null;
  readonly span: Span;
}

export class VelarWebAnalyzer extends Analyzer {
  private componentStates: Set<string> | null = null;
  private mountedDepth = 0;
  private cleanupDepth = 0;
  /** D51 (audit 12): a component `watch` body runs on a change and ends, exactly as a module `watch` body does. */
  private watchBodyDepth = 0;
  /** D89 A4: the binding identity of every list a keyed `.map(...)` interpolation renders. */
  private readonly keyedListSources = new Set<string>();
  /** D89 A4: every row rebuild of this module — assigned or derived — in source order. */
  private readonly keyedListRebuilds: KeyedListRebuild[] = [];
  /** D89 A4: this module's `def` bodies by name, so a `computed` that calls one can be read through. */
  private moduleFunctions: ReadonlyMap<string, FunctionDeclarationStatement | null> = new Map();
  private synchronousReactiveDepth = 0;
  private jsxDepth = 0;
  /** VEL5075: how many component bodies enclose the declaration being analyzed. */
  private componentBodyDepth = 0;
  private readonly resources: ReadonlyMap<string, string>;
  private readonly unsafeCssImports = new Set<string>();
  private readonly probedOperandTypes = new Map<string, ValueType>();
  private readonly importedLookStaticValues: ReadonlyMap<string, LookStaticValue>;
  private lookStaticValues: ReadonlyMap<string, LookStaticValue> = new Map();
  private readonly lookEntryScopes = new Map<string, Set<string>>();
  private readonly derivedReactiveNames = new Set<string>();
  private readonly checkedBuilderCalls = new Set<string>();
  private readonly staticJsxKeys: { readonly element: JSXElementExpression; readonly attribute: JSXAttribute }[] = [];
  private readonly honoredJsxKeys = new Set<JSXElementExpression>();
  private readonly reportedJsxKeys = new Set<JSXElementExpression>();
  private lookBuilderNames: ReadonlyMap<string, string> = new Map();
  /**
   * D103: the module's `velar/look` import, so the migration off
   * `color("var(--x)")` can write the `token` import it needs in the same
   * rewrite. A migration that only changed the call would leave the module
   * naming a builder it never imported, which is not a mechanical fix.
   */
  private lookImport: LookImportSite | null = null;
  private lookDeclarations: ReadonlyMap<string, WebLookExpression | null> = new Map();
  private lookLiteralDepth = 0;
  /**
   * D71 rule 182: the declaration spans of every `computed` binding in scope.
   * A binding's span survives narrowing, so it identifies the declaration a
   * name resolves to even where a narrowed copy answers the lookup.
   */
  private readonly computedBindingSpans = new Set<string>();
  /** Local names bound to an imported `export computed`, from the Web interface. */
  private readonly importedComputedNames: ReadonlySet<string>;
  /** The resolved spans of those imports, so a local shadow of the name is not one. */
  private readonly importedComputedSpans = new Set<string>();
  /** D71 migration state: `const x = computed(...)` sites, their reads, and every other reference to the name. */
  private readonly retiredAccessorDeclarations = new Map<string, RetiredAccessorDeclaration>();
  private readonly retiredAccessorReads = new Map<string, Span[]>();
  private readonly retiredComputedReferences = new Map<string, { readonly name: string; readonly span: Span }>();
  private readonly migratedComputedCallees = new Set<string>();
  /** Callee span identity -> call span, for every zero-argument call of a plain name. */
  private readonly plainCallSpans = new Map<string, Span>();
  /** D57 rule 138: `velar/web-test` is legal only where the browser runner looks. */
  private readonly webModulePath: string | null;
  /** The source coordinates used by mechanical JSX attribute rewrites. */
  private readonly webSourceText: string;
  /** D74: only props whose authors wrote a readonly contract receive prop-specific guidance. */
  private explicitReadonlyPropBindings: ReadonlyMap<string, number> = new Map();

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.webModulePath = context.path ?? null;
    this.webSourceText = context.sourceText ?? "";
    this.resources = context.resources ?? new Map();
    const webImports = [...(context.extensionImports?.get("@velarscript/web") ?? [])];
    this.importedLookStaticValues = new Map(
      webImports.filter((entry): entry is [string, LookStaticValue] => isLookStaticValue(entry[1])),
    );
    this.importedComputedNames = new Set(
      webImports.filter(([, value]) => isWebComputedExport(value)).map(([name]) => name),
    );
  }

  override analyze(program: Program): readonly Diagnostic[] {
    this.lookStaticValues = collectLookStaticValues(program, this.importedLookStaticValues);
    this.lookBuilderNames = collectLookBuilderNames(program);
    this.lookImport = collectLookImportSite(program);
    this.lookDeclarations = collectLookDeclarations(program);
    for (const name of collectDerivedReactiveNames(program)) this.derivedReactiveNames.add(name);
    this.reportBrowserTestImports(program);
    this.rejectWebOwnedTypeNames(program);
    this.keyedListSources.clear();
    this.keyedListRebuilds.length = 0;
    this.moduleFunctions = collectModuleFunctions(program);
    super.analyze(program);
    this.reportStaticJsxKeys();
    this.reportRetiredComputedFunction();
    this.adviseKeyedListRebuilds();
    return this.diagnostics;
  }

  /**
   * D57 rule 138: `velar/web-test` only has a runtime under `velar test
   * --browser`, so an import of it anywhere else compiles a call that cannot
   * succeed. D51 rule 109 puts the refusal at the declaration rather than at the
   * eventual use, so the error lands on the `import` line — including the
   * JavaScript-bridge and re-export spellings, which reach the same runtime.
   */
  private reportBrowserTestImports(program: Program): void {
    if ((this.webModulePath ?? "").endsWith(BROWSER_TEST_SOURCE_SUFFIX)) return;
    for (const statement of program.body) {
      if (statement.kind !== "ImportDeclaration" && statement.kind !== "ReExportDeclaration") continue;
      if (statement.source !== BROWSER_TEST_MODULE) continue;
      this.diagnostics.push(diagnostic("VEL5062", browserTestImportGuidance(), statement.sourceSpan));
    }
  }

  /**
   * D72 rule 186: a Web module publishes its own type names, and a user
   * declaration of one used to be accepted at the declaration and then lose at
   * every use — `type Event:` compiled, and `describe({kind: "charge"})` was
   * told it could not assign to `Event`, naming a type the author had just
   * written. D51 rule 109 already settled where that refusal belongs: at the
   * declaration, which is the only place a rename is cheap.
   *
   * The names come from the extension's own published table, so adding a type
   * to `WEB_OWNED_TYPE_NAMES` extends this protection with it. The last time
   * this family was repaired by listing names instead of deriving them, the
   * list drifted; D57 rule 135 is the same repair on the Core roster.
   *
   * Core now says the same sentence about its own built-in type names —
   * `builtinTypeNameDeclarationMessage` in packages/compiler/src/analyzer.ts,
   * reported as VEL3007. The rosters differ; the wording is meant to read
   * alike, so a change to either sentence belongs in both.
   */
  private rejectWebOwnedTypeNames(program: Program): void {
    const reject = (name: string, errorSpan: Span, noun: string): void => {
      if (!WEB_OWNED_TYPE_NAMES.has(name)) return;
      this.diagnostics.push(diagnostic(
        "VEL5065",
        `'${name}' is a Web type name, so it cannot also name ${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}; every use of it in a Web module resolves to the built-in. Rename this declaration`,
        errorSpan,
      ));
    };
    for (const statement of program.body) {
      switch (statement.kind) {
        case "TypeDeclaration":
        case "TypeAliasDeclaration":
          reject(statement.name, statement.span, "type");
          break;
        case "ClassDeclaration":
          reject(statement.name, statement.span, "class");
          break;
        case "EnumDeclaration":
          reject(statement.name, statement.span, "enum");
          break;
        case "ExternModuleDeclaration":
          for (const declaration of statement.classes) reject(declaration.name, declaration.span, "extern class");
          break;
        case "ImportDeclaration":
          // A standard-module import of the name under itself *is* the built-in
          // — `import {Color, Length} from "velar/look"` is how a module names
          // the published types — so only a binding that would make the name
          // mean something else is refused.
          if (statement.source.startsWith("velar/")) {
            for (const specifier of statement.specifiers) {
              if (specifier.local !== specifier.imported) reject(specifier.local, statement.span, "import alias");
            }
            break;
          }
          for (const specifier of statement.specifiers) {
            reject(specifier.local, statement.span, specifier.local === specifier.imported ? "imported name" : "import alias");
          }
          break;
        default:
          break;
      }
    }
  }

  /**
   * WEB-C1: charter §14 promises that a key outside a keyed shape is a
   * diagnostic rather than a silent no-op. Interpolated positions report while
   * their interpolation is walked; static positions are collected during JSX
   * inference and reported once every keyed interpolation is known.
   */
  private reportStaticJsxKeys(): void {
    for (const { element, attribute } of this.staticJsxKeys) {
      if (this.honoredJsxKeys.has(element) || this.reportedJsxKeys.has(element)) continue;
      this.diagnostics.push(diagnostic(
        "VEL5050",
        `This JSX key has no effect: '<${element.tag}>' is rendered in a fixed position, and keys reuse children by identity only inside 'items.map(item => <Row key={item.id} />)' — remove the key, or render this element from a keyed .map()`,
        attribute.span,
      ));
    }
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (!isWebStatement(statement)) return false;
    if (statement.kind === "ExtensionStatement:web:unsafe-css") return true;
    if (statement.kind !== "ExtensionStatement:web:component") return false;
    this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    // Two core statement shapes are answered here before the core sees them:
    // a write to a derived name, which the const message would describe wrongly,
    // and a `const x = computed(...)` declaration, whose migration needs the
    // declaration recorded before its reads are walked.
    if (statement.kind === "AssignmentStatement" && this.rejectComputedAssignment(statement)) return true;
    if (statement.kind === "VariableDeclaration") {
      this.recordRetiredAccessorDeclaration(statement);
    }
    if (statement.kind === "FunctionDeclaration") {
      this.rejectStatefulWebNodeFunction(statement);
      this.rejectUnownedComponentElement(statement);
    }
    if (!isWebStatement(statement)) return false;
    switch (statement.kind) {
      case "ExtensionStatement:web:component":
        // A component body renders after module evaluation, so its reads are
        // deferred for the module-initialization-cycle classification even
        // though component analysis itself runs without a function frame.
        this.deferredExecutionDepth += 1;
        try {
          this.analyzeComponent(statement);
        } finally {
          this.deferredExecutionDepth -= 1;
        }
        return true;
      case "ExtensionStatement:web:state": {
        const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
        const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
        const actual = this.inferExpression(statement.initializer, annotationContext ?? unknownType);
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
        this.requireSettledCollectionElement(statement.initializer, declared, annotationContext !== null);
        this.declareBinding(statement.name, true, declared, statement.span);
        this.markDeclaredBindingReactive(statement.name, "state");
        return true;
      }
      case "ExtensionStatement:web:computed":
        this.analyzeComputedDeclaration(statement);
        return true;
      case "ExtensionStatement:web:resource":
        this.diagnostics.push(diagnostic("VEL3012", "'resource' is only valid at component scope; a module-scope async operation belongs in a module 'action'", statement.span));
        this.analyzeResourceDeclaration(statement);
        return true;
      case "ExtensionStatement:web:action":
        // A module-scope action behaves exactly like a component action —
        // reactive pending/error fields with rejection semantics preserved —
        // but its lifetime is the module, so it never registers disposal.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3013", "'action' is only valid at module or component scope", statement.span));
        }
        this.analyzeActionDeclaration(statement);
        return true;
      case "ExtensionStatement:web:watch":
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3010", "'watch' is only valid at module or component scope", statement.span));
          return true;
        }
        this.flowFrameDepth += 1;
        this.synchronousReactiveDepth += 1;
        {
          // The watched expression evaluates while the module initializes;
          // the body only runs on a later change, so its reads are deferred
          // for the module-initialization-cycle classification.
          const watched = this.inferExpression(statement.expression);
          this.rejectFrozenWatchSubject(statement.expression, watched, statement.currentName, statement.previousName);
          this.enterScope();
          if (statement.currentName) this.declareBinding(statement.currentName, false, watched, statement.span);
          if (statement.previousName) this.declareBinding(statement.previousName, false, watched, statement.span);
          this.deferredExecutionDepth += 1;
          try {
            this.analyzeStatements(statement.body);
          } finally {
            this.deferredExecutionDepth -= 1;
          }
          this.exitScope();
        }
        this.synchronousReactiveDepth -= 1;
        this.flowFrameDepth -= 1;
        return true;
      case "ExtensionStatement:web:unsafe-css": {
        // LOK-D2 / D53: unsafe CSS is a module-level ordering declaration,
        // whether its source is an external resource or an inline raw block.
        // Nested inside a component or a function it used to pass every check,
        // build, and then appear in no output at all.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS is module-level; move the declaration to the top of the module so its order against Look stays visible", statement.span));
          return true;
        }
        if (statement.source.kind === "external" && this.unsafeCssImports.has(statement.source.path)) {
          this.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source.path}' is imported more than once; each stylesheet must have one explicit order position`, statement.span));
        }
        if (statement.source.kind === "external") this.unsafeCssImports.add(statement.source.path);
        const source = statement.source.kind === "inline" ? statement.source.css : this.resources.get(statement.source.path);
        const subject = statement.source.kind === "inline" ? "Inline unsafe CSS" : `Unsafe CSS '${statement.source.path}'`;
        if (source && containsCssImport(source)) {
          this.diagnostics.push(diagnostic("VEL5037", `${subject} contains @import; declare every stylesheet with 'import css unsafe' so project order remains visible`, statement.source.span));
        }
        if (source) {
          const relativeAddress = firstRelativeCssAssetAddress(source);
          if (relativeAddress) this.diagnostics.push(diagnostic("VEL5037", `${subject} uses relative asset address ${relativeAddress.syntax}(${JSON.stringify(relativeAddress.value)}); use a project-public /path, data URL, fragment, or absolute URL so extracted asset ownership stays explicit`, statement.source.span));
        }
        return true;
      }
      default:
        return false;
    }
  }

  protected override analyzeStatement(statement: Statement): void {
    const readonlyProp = this.directReadonlyPropMutation(statement);
    this.recordKeyedListRebuild(statement);
    const firstDiagnostic = this.diagnostics.length;
    super.analyzeStatement(statement);
    if (!readonlyProp) return;
    for (let index = firstDiagnostic; index < this.diagnostics.length; index += 1) {
      const item = this.diagnostics[index]!;
      if ((item.code !== "VEL3002" && item.code !== "VEL4001") || !/read-?only|readonly/iu.test(item.message)) continue;
      this.diagnostics[index] = {
        ...item,
        message: `Cannot mutate prop '${readonlyProp}': this component's author explicitly declared it 'readonly'. ${item.message}`,
      };
    }
  }

  private directReadonlyPropMutation(statement: Statement): string | null {
    let target: Expression | null = null;
    if (statement.kind === "AssignmentStatement" && statement.target.kind !== "IdentifierExpression") {
      target = statement.target;
    } else if (statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression"
      && statement.expression.callee.kind === "MemberExpression") {
      target = statement.expression.callee.object;
    }
    if (!target) return null;
    const name = this.rootBindingName(target);
    if (!name) return null;
    const binding = this.lookup(name);
    return binding && this.explicitReadonlyPropBindings.get(name) === binding.span.start ? name : null;
  }

  private rootBindingName(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") return expression.name;
    if (expression.kind === "MemberExpression" || expression.kind === "IndexExpression") {
      return this.rootBindingName(expression.object);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression") {
      return this.rootBindingName(expression.callee.object);
    }
    return null;
  }

  protected override prescanExtensionScopeDeclaration(statement: Statement): { readonly name: string; readonly span: Span } | null {
    if (!isWebStatement(statement)) return null;
    return statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:computed"
      || statement.kind === "ExtensionStatement:web:resource"
      ? { name: statement.name, span: statement.span }
      : null;
  }

  /**
   * D71 rule 182: a derived value is reactive and read-only, which is exactly
   * the reactive identity a component prop already carries — a bare read lowers
   * through `.get()`, and nothing may write it. Registering that identity
   * rather than `state` is what keeps `bind={doubled}` and every other writable
   * position refusing a derived name for free.
   */
  private analyzeComputedDeclaration(statement: ComputedDeclaration): void {
    const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
    const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
    // The initializer re-runs on every dependency change, so it is a deferred
    // read for the module-initialization-cycle classification, exactly like a
    // watch subject.
    this.synchronousReactiveDepth += 1;
    const actual = this.inferExpression(statement.initializer, annotationContext ?? unknownType);
    this.synchronousReactiveDepth -= 1;
    const declared = annotationContext ?? actual;
    if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
    this.declareBinding(statement.name, false, declared, statement.span);
    this.markDeclaredBindingReactive(statement.name, "prop");
    this.computedBindingSpans.add(spanIdentity(statement.span));
    this.recordDerivedKeyedListRebuild(statement);
  }

  /**
   * True when `name` resolves to a `computed` declaration or to an imported one.
   * The question is asked of the *binding* the name resolves to, never of the
   * spelling: a local `state` may shadow an imported derived name, and that
   * shadow is writable state.
   */
  private isComputedBinding(name: string): boolean {
    const binding = this.lookup(name);
    return binding !== null && this.computedBindingSpans.has(spanIdentity(binding.span));
  }

  private isImportedComputedBinding(name: string): boolean {
    const binding = this.lookup(name);
    return binding !== null && this.importedComputedSpans.has(spanIdentity(binding.span));
  }

  /**
   * D71 rule 184: a cross-module `computed` travels through `reactiveExports`
   * so its bare read lowers through `.get()` like an exported `state` — but it
   * is not writable, and the imported binding must not inherit the writable
   * identity that carries `bind={...}` and `event => name = ...`. The Web
   * extension publishes which exported names are derived, so the import is
   * demoted to the read-only reactive identity here.
   */
  protected override markDeclaredBindingReactive(name: string, kind: "state" | "prop" = "state"): void {
    // Only the import itself is demoted. A local `state` of the same name in a
    // component or a block is a shadow that really is writable, and demoting it
    // would compile its assignment as a plain store into the handle.
    const imported = kind === "state" && this.isTopLevelScope() && this.importedComputedNames.has(name);
    super.markDeclaredBindingReactive(name, imported ? "prop" : kind);
    if (!imported) return;
    const binding = this.lookup(name);
    if (!binding) return;
    this.computedBindingSpans.add(spanIdentity(binding.span));
    this.importedComputedSpans.add(spanIdentity(binding.span));
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount") {
      const namedNode = expression.argumentNames?.findIndex((name) => name === "node") ?? -1;
      const node = expression.arguments[namedNode >= 0 ? namedNode : 0];
      if (node && expressionContainsDirectAwait(node, (value) => value.kind === "ExtensionExpression:web:jsx" ? false : undefined)) {
        this.diagnostics.push(diagnostic(
          "VEL4007",
          "mount constructs its root synchronously; await the root in a separate module binding before calling mount",
          node.span,
        ));
      }
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
      const operand = this.inferExpression(expression.operand);
      if (isLookNumericType(operand)) {
        this.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
        return operand;
      }
      this.probedOperandTypes.set(spanIdentity(expression.operand.span), operand);
    }
    // WEB-U15 / GRM-A3: '&&' rendering is the React habit. The lexer now starts
    // JSX after 'and'/'or' so the shape parses and this rejection names the
    // conditional-rendering spelling instead of leaking a bool type error.
    if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")
      && (isWebJsx(expression.left) || isWebJsx(expression.right))) {
      const rightIsElement = isWebJsx(expression.right);
      const tag = rightIsElement ? expression.right.tag : isWebJsx(expression.left) ? expression.left.tag : "";
      const condition = lookSourceOf(rightIsElement ? expression.left : expression.right);
      this.inferExpression(expression.left);
      this.inferExpression(expression.right);
      this.diagnostics.push(diagnostic(
        "VEL5029",
        `'${expression.operator}' combines bool values and cannot yield an element; render conditionally with '{${condition} ? <${tag || ">"} ... : null}'`,
        expression.span,
      ));
      return invalidType;
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
      const left = this.inferExpression(expression.left);
      const right = this.inferExpression(expression.right);
      if (!isLookNumericType(left) && !isLookNumericType(right)) {
        this.probedOperandTypes.set(spanIdentity(expression.left.span), left);
        this.probedOperandTypes.set(spanIdentity(expression.right.span), right);
      } else {
        const additive = expression.operator === "+" || expression.operator === "-" ? lookAdditiveType(left, right) : null;
        const result = additive
          ?? ((expression.operator === "*" || expression.operator === "/") && isLookNumericType(left) && right.kind === "number" ? left : null)
          ?? (expression.operator === "*" && left.kind === "number" && isLookNumericType(right) ? right : null);
        if (result) {
          // LOK-U8: dividing a visual value by a literal zero produces a
          // non-finite length that the runtime rejects on first construction.
          if (expression.operator === "/" && lookLiteralZero(expression.right)) {
            this.diagnostics.push(diagnostic("VEL5042", "Look unit arithmetic cannot divide by zero", expression.span));
            return invalidType;
          }
          this.extensionCalls.set(spanIdentity(expression.span), LOOK_ARITHMETIC_HINT);
          return result;
        }
        // The rejection is final: returning the invalid type keeps the Look
        // property's own assignment error from co-reporting a union dump on the
        // very expression that was already named (LOK-I1).
        this.diagnostics.push(diagnostic("VEL5042", `Look unit arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span));
        return invalidType;
      }
    }
    // WEB-N2 / D47 rule 84: the event object is typed down to event semantics
    // and deliberately carries no target, so `event.target.value` is a dead end
    // that used to cascade into three unknown-access errors. The read is where
    // the author wanted two-way binding, so it names that spelling and stops.
    if (expression.kind === "MemberExpression" && !expression.optional && webEventDeadFields.has(expression.property)
      && expression.object.kind === "IdentifierExpression") {
      const binding = this.lookup(expression.object.name);
      const expanded = binding ? this.expandAliases(binding.type) : null;
      if (expanded?.kind === "named" && webEventTypeNames.has(expanded.name)) {
        this.diagnostics.push(diagnostic(
          "VEL5019",
          `A VelarScript event object carries typed event fields only and has no '${expression.property}': read the element's value through a two-way binding instead — 'bind:value={name}' binds a state name, and 'bind:value={form.field}' or 'bind:value={items[0]}' binds a writable path inside state`,
          expression.span,
        ));
        return invalidType;
      }
    }
    if (isWebJsx(expression)) return this.inferJsx(expression);
    if (isWebKeyframes(expression)) {
      this.analyzeKeyframes(expression);
      return { kind: "named", name: "Keyframes" };
    }
    if (isWebLook(expression)) {
      this.lookLiteralDepth += 1;
      try {
        this.analyzeLookEntries(expression.entries, false, false, 1, `look:${expression.span.start}`);
      } finally {
        this.lookLiteralDepth -= 1;
      }
      return { kind: "named", name: "Look" };
    }
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
      this.diagnostics.push(diagnostic("VEL5038", `Look hook '@${expression.name}' is only valid inside a Look condition`, expression.span));
      return boolType;
    }
    if (isWebUnit(expression)) {
      const type = LOOK_UNIT_TYPES.get(expression.unit);
      if (type) return { kind: "named", name: type };
      return unknownType;
    }
    return undefined;
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    // Operands probed for Look arithmetic are re-requested by the core analyzer immediately after the
    // probe declines; reusing the probe result (consume-once) keeps operand analysis single-run so
    // operand diagnostics are not reported twice.
    const key = spanIdentity(expression.span);
    const probed = this.probedOperandTypes.get(key);
    if (probed !== undefined) {
      this.probedOperandTypes.delete(key);
      return probed;
    }
    if (expression.kind === "CallExpression" && expression.arguments.length === 0
      && expression.callee.kind === "IdentifierExpression") {
      this.plainCallSpans.set(spanIdentity(expression.callee.span), expression.span);
      const called = this.calledComputedBinding(expression);
      if (called) return called;
    }
    if (expression.kind === "IdentifierExpression") {
      const retired = this.recordRetiredAccessorRead(expression);
      // The retired name is answered here rather than left to fall through as an
      // unknown one: the author gets its migration and nothing else, and the
      // call around it still type-checks against the signature it always had.
      if (retired) return RETIRED_ACCESSOR_TYPE;
    }
    const result = super.inferExpression(expression, contextualType);
    if (expression.kind === "CallExpression") {
      this.checkLookBuilderCall(expression);
    }
    return result;
  }

  // A name refers to writable reactive state only when ordinary lexical lookup
  // still resolves it to the state binding; a shadowing local wins instead.
  private writableStateName(name: string): boolean {
    return this.reactiveBindingKind(name) === "state";
  }

  /**
   * P2b-5: a `def` that answers markup and answers it with a component element.
   *
   * Everything about the shape is legal one step out. A component element is a
   * legal module-level expression — `const root = <App />` is the instantiation
   * site D90 R4-b rules on, and `mount` takes exactly the instance it evaluates
   * to. A `def` answering markup is a legal markup helper — dispatch over a
   * closed vocabulary is what the P2b wave was writing. The defect is only
   * where the two meet, and it is a representation split the type does not
   * carry: a component element in a *child* position lowers to `__velarChild`,
   * which owns a scope and answers a DOM node, while the same element standing
   * alone lowers to `__velarInstantiate`, which answers an instance. Both are
   * typed `WebNode`; only one is one. Returned from a helper and handed to a
   * render, the instance reaches `__velarAppend` and takes the whole subtree
   * down with "JSX can render only text, finite numbers, bool, enums, WebNode
   * values, and Lists of those values" — the check-green, runtime-dead shape.
   *
   * The walk stops at every JSX element, which is exactly where the emitter
   * stops: inside one, every position is a child position and every component
   * element there is already correct — `return <div><Badge /></div>` and an
   * interpolated `{cond ? <Badge /> : ...}` both work today and must keep
   * working. Only a component element the returned markup *starts* with is the
   * defect, including one reached through a `.map(...)` answering a row per
   * item, which fails the same way for the same reason.
   */
  private rejectUnownedComponentElement(statement: Extract<Statement, { readonly kind: "FunctionDeclaration" }>): void {
    // A helper nested in a component body is emitted with that component's
    // scope in hand, so its component elements are `__velarChild` and answer
    // nodes. Only a helper standing outside every component body has nowhere
    // for the emitter to put them.
    if (this.componentBodyDepth > 0) return;
    const answersMarkup = statement.returnType
      ? carriesWebNode(this.resolveAnnotation(statement.returnType))
      : bodyReturnsJsx(statement.body);
    if (!answersMarkup) return;
    for (const element of returnedMarkupRoots(statement.body)) {
      if (!/^[A-Z]/u.test(element.tag)) continue;
      this.diagnostics.push(diagnostic(
        "VEL5075",
        `'${statement.name}' answers markup with the component element '<${element.tag} />', and a component element standing on its own is an instance rather than a node: it is built by the position that shows it, and a 'def' is not one, so what this returns fails the moment JSX tries to render it. Write '<${element.tag} />' where it is rendered — a component's own body, or a child position inside markup this returns such as '<div><${element.tag} ... /></div>' — and keep the helper for the native elements it builds.`,
        element.span,
      ));
    }
  }

  /**
   * The audit's seventh root cause: a `def` that declares reactive state and
   * answers `WebNode` is a component wearing a function's clothes, and calling
   * it bypasses exactly what the charter already refuses `View(...)` for. Two
   * things follow from the call, both reproduced: every call runs the `state`
   * declaration again, so the value resets on every re-render; and the
   * observers the returned markup registers bind to whatever scope the call
   * site was building — at module scope the global one, which is never
   * destroyed, so they are never cleaned up.
   *
   * Only DECLARATION is refused. A `def -> WebNode` that merely reads state or a
   * prop is a legitimate markup helper — examples/app has two — and a `def`
   * nested inside a component binds its observers to that component's scope, so
   * nothing about reading is defective.
   *
   * What answers "this `def` returns markup" is the sink, not one spelling of
   * it: `-> WebNode?` and `-> List<WebNode>` are the shapes markup travels in,
   * and a `def` may carry no return type at all — all three reached the same
   * defect with the same body while only the bare annotation was read.
   */
  private rejectStatefulWebNodeFunction(statement: Extract<Statement, { readonly kind: "FunctionDeclaration" }>): void {
    const answersMarkup = statement.returnType
      ? carriesWebNode(this.resolveAnnotation(statement.returnType))
      : bodyReturnsJsx(statement.body);
    if (!answersMarkup) return;
    const declaration = firstReactiveDeclaration(statement.body);
    if (!declaration) return;
    const component = componentSpelling(statement.name);
    this.diagnostics.push(diagnostic(
      "VEL5074",
      `'${statement.name}' declares ${declaration.label} and returns WebNode, so calling it bypasses JSX ownership, prop cells, and lifecycle: every call declares the value again, so it resets on each render, and the observers its markup registers belong to whatever scope the call site was building rather than to this value. Write it as a component — 'component ${component}(...)' rendered as '<${component} />'; a 'def' that returns WebNode is a markup helper and may only read.`,
      declaration.span,
    ));
  }

  /**
   * D71 rule 182: a declared derived value is read bare, exactly like state.
   * Calling one is the habit the retired `computed(...)` accessor taught, and it
   * is also what a half-migrated project looks like from the importing side — so
   * the answer names the one spelling and carries the edit that reaches it,
   * which is what lets `velar fix` finish a migration that crosses modules.
   */
  private calledComputedBinding(expression: Extract<Expression, { readonly kind: "CallExpression" }>): ValueType | null {
    if (expression.callee.kind !== "IdentifierExpression") return null;
    const name = expression.callee.name;
    if (!this.isComputedBinding(name)) return null;
    const type = this.inferExpression(expression.callee);
    // A derived value that *is* a function is called on purpose; only a
    // non-callable one makes the parentheses a mistake.
    const expanded = this.expandAliases(type);
    if (expanded.kind === "function" || expanded.kind === "intrinsic" || expanded.kind === "any" || isInvalidType(expanded)) return null;
    this.diagnostics.push({
      code: "VEL5063",
      message: `'${name}' is a computed value, not a reader: it is read bare like state, so write '${name}' rather than '${name}()'`,
      span: expression.span,
      fix: {
        title: `Read '${name}' bare`,
        edits: [{ span: { start: expression.callee.span.end, end: expression.span.end }, text: "" }],
      },
    });
    return type;
  }

  /**
   * D69 rule 178: a `watch` body that can never run is a block of statements
   * the compile silently drops — the same defect a bare `5` is already rejected
   * for (VEL4030), reached from a position the rule could not see.
   *
   * D90 R15(a) adds the third refusal and fixes the order the three are asked
   * in. A frozen subject is answered before the shape rule so that one shape
   * never draws two messages: a subject built only from frozen parts has no
   * reactive source at all, and telling its author to declare a `computed`
   * would only buy him a dead one. What survives both is either a path — the
   * name of a reactive binding, or a member/index read out of one — or a
   * computation, and a computation has a spelling of its own.
   *
   * The three refusals are separate because their causes are: a reader that was
   * not called names a value that never moves, a frozen value has no reactive
   * source behind it at all, and a computed subject has one but hides which.
   */
  private rejectFrozenWatchSubject(
    expression: Expression,
    watched: ValueType,
    currentName: string | null,
    previousName: string | null,
  ): void {
    const name = expression.kind === "IdentifierExpression" ? expression.name : null;
    if (name !== null && this.reactiveBindingKind(name) === null && this.zeroArgumentReader(watched)) {
      this.diagnostics.push(diagnostic(
        "VEL5064",
        `'${name}' is the reader itself, so watching it watches a value that never changes; declare the derived value — 'computed name = ${name}()' — then 'watch name:'`,
        expression.span,
      ));
      return;
    }
    if (this.frozenWatchSubject(expression)) {
      this.diagnostics.push(diagnostic(
        "VEL5064",
        `This watch subject never changes, so its body can never run${name === null ? "" : ` — '${name}' is not a reactive source`}; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run`,
        expression.span,
      ));
      return;
    }
    if (watchSubjectPath(expression)) return;
    // D69's own shape, `watch total()`, is a called `computed`, and VEL5063 has
    // already named it with the one-character edit that makes this subject
    // legal. Stacking the shape rule on top would report one mistake twice and
    // would hand the author 'computed value = total()' — a line that reports
    // VEL5063 in its turn. The same reason the frozen rule is asked first.
    if (this.diagnostics.some((item) => item.code === "VEL5063"
      && item.span.start === expression.span.start && item.span.end === expression.span.end)) return;
    const derived = currentName ?? "value";
    const watchLine = currentName === null
      ? `watch ${derived}:`
      : `watch ${derived} as current${previousName === null ? "" : `, ${previousName}`}:`;
    const rendered = renderWatchSubject(expression);
    this.diagnostics.push(diagnostic(
      "VEL5071",
      rendered === null
        ? `A watch subject names what to watch, not what to compute. Declare the value — 'computed ${derived} = ...' — then '${watchLine}'`
        : `A watch subject names what to watch, not what to compute: '${rendered}' computes a value. Declare it — 'computed ${derived} = ${rendered}' — then '${watchLine}'`,
      expression.span,
    ));
  }

  /**
   * D89 A4: records `list = list.map(item => {…})`, React's immutable update,
   * where the callback builds a new record rather than changing a field.
   *
   * D90 R2 stands — `__velarKeyed` compares identity and that does not move,
   * and the framework does not accommodate the idiom. This channel is not the
   * framework taking responsibility; it is the compiler telling the author that
   * the row he is typing into is about to be destroyed. Nothing is reported
   * yet: the advisory is owed only if the rewritten list is what a keyed list
   * renders, and the render usually sits below the update.
   */
  private recordKeyedListRebuild(statement: Statement): void {
    if (statement.kind !== "AssignmentStatement" || statement.operator !== "=") return;
    if (statement.target.kind !== "IdentifierExpression") return;
    const value = statement.value;
    if (value.kind !== "CallExpression" || value.callee.kind !== "MemberExpression" || value.callee.property !== "map") return;
    // The map has to be over the list being replaced; `rows = source.map(...)`
    // builds a new list, and a new list has no identity to preserve.
    if (value.callee.object.kind !== "IdentifierExpression" || value.callee.object.name !== statement.target.name) return;
    const callback = value.arguments[0];
    if (!callback || callback.kind !== "ArrowFunctionExpression") return;
    const [row] = callback.parameters;
    if (!row || callback.parameters.length !== 1) return;
    const rebuilt = keyedRebuiltRecord(callback.body, row.name);
    if (!rebuilt) return;
    const binding = this.lookup(statement.target.name);
    if (!binding) return;
    this.keyedListRebuilds.push({
      kind: "assignment",
      source: spanIdentity(binding.span),
      name: statement.target.name,
      field: rebuilt.field,
      span: statement.span,
    });
  }

  /**
   * D89 A4, the wider proven shape: the same churn written as a derived value.
   * `computed rows = source.map(item => {…})` and `computed rows = build(...)`
   * over a `for`/`append` builder both hand a keyed position a fresh record for
   * every row on every recompute, which is exactly what the assignment shape
   * does — the reconciliation wave compiled both and found only one of them
   * named. It is one advisory with a wider proof, not a second code: the defect,
   * the consequence, and the suppression are the same.
   *
   * A `const` in a component body is deliberately not here. It is constructed
   * once, so its records never move, and advising it would be a guess rather
   * than a proof.
   */
  private recordDerivedKeyedListRebuild(statement: ComputedDeclaration): void {
    if (!this.rebuildsRecordsPerElement(statement.initializer)) return;
    this.keyedListRebuilds.push({
      kind: "derived",
      source: spanIdentity(statement.span),
      name: statement.name,
      field: null,
      span: statement.span,
    });
  }

  /**
   * Whether a derived initializer constructs one fresh record per source
   * element. Two spellings are proven and everything else is silent: a `map`
   * whose callback answers a record literal — the same recognizer the
   * assignment shape uses — and a call to a `def` this module declares whose
   * whole answer is a list it filled with record literals.
   */
  private rebuildsRecordsPerElement(value: Expression): boolean {
    if (value.kind !== "CallExpression") return false;
    if (value.callee.kind === "MemberExpression" && value.callee.property === "map") {
      const callback = value.arguments[0];
      if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.parameters.length !== 1) return false;
      const [row] = callback.parameters;
      return row !== undefined && keyedRebuiltRecord(callback.body, row.name) !== null;
    }
    if (value.callee.kind !== "IdentifierExpression") return false;
    const declaration = this.moduleFunctions.get(value.callee.name);
    return declaration !== undefined && declaration !== null && buildsFreshRecords(declaration);
  }

  /**
   * D89 A4: raises the advisory for the rebuilds whose list a keyed position
   * really renders. The advisory channel cannot reach `this.diagnostics`, so
   * nothing here fails a build, changes an emitted byte, or moves a semantic
   * rule; `// velar-allow A4: <reason>` suppresses it where building the rows is
   * the only spelling, which a `readonly` list or one API response makes it.
   */
  private adviseKeyedListRebuilds(): void {
    for (const rebuild of this.keyedListRebuilds) {
      if (!this.keyedListSources.has(rebuild.source)) continue;
      // The keys do not move; the rows do. `__velarKeyed` finds the entry under
      // the same key and then drops it because the row it holds is no longer
      // the same value, so a message blaming the key sends an author to check
      // `id`, find it unchanged, and conclude the advisory is wrong.
      // A derived value has no row to write: whatever it hands the keyed
      // position it built itself. The two ways out are to render the rows that
      // do have an identity, or to carry those same records through.
      const remedy = rebuild.kind === "derived"
        ? "A derived value cannot keep rows it builds: render the source rows and change the field on them in place, or carry the source records through instead of constructing new ones."
        : `Change the field in place instead: '${rebuild.name}[index].${rebuild.field ?? "<field>"} = ...'`;
      this.advise(
        "A4",
        `This rebuilds every row of '${rebuild.name}'${rebuild.kind === "derived" ? " on every recompute" : ""}, so every row is a new value and the keyed list that renders '${rebuild.name}' no longer recognises any of them: it destroys and rebuilds all of its children — an input being typed into loses focus. ${remedy}`,
        rebuild.span,
      );
    }
  }

  /** A value that is read by calling it and takes no arguments to do so. */
  private zeroArgumentReader(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return (expanded.kind === "function" || expanded.kind === "intrinsic") && expanded.requiredParameters === 0;
  }

  /**
   * True only for subjects built entirely from values the compile can see are
   * frozen: literals, and non-reactive bindings whose type is a primitive, so no
   * deep-reactive object can be hiding behind the name. Every member access,
   * index, and call is excluded on purpose — `alias.done` on a const bound to a
   * reactive element does track, and a call can read anything.
   */
  private frozenWatchSubject(expression: Expression): boolean {
    switch (expression.kind) {
      case "LiteralExpression":
        return true;
      case "FStringExpression":
        return expression.parts.every((part) => part.kind === "text" || this.frozenWatchSubject(part.value));
      case "IdentifierExpression":
        return this.reactiveBindingKind(expression.name) === null
          && !this.derivedReactiveNames.has(expression.name)
          && this.frozenValueType(this.lookup(expression.name)?.type ?? unknownType);
      case "UnaryExpression":
        return expression.operator !== "await" && this.frozenWatchSubject(expression.operand);
      case "BinaryExpression":
        return this.frozenWatchSubject(expression.left) && this.frozenWatchSubject(expression.right);
      case "ComparisonChainExpression":
        return expression.operands.every((operand) => this.frozenWatchSubject(operand));
      case "ConditionalExpression":
        return this.frozenWatchSubject(expression.condition) && this.frozenWatchSubject(expression.thenValue)
          && this.frozenWatchSubject(expression.elseValue);
      case "IsExpression":
        return this.frozenWatchSubject(expression.value);
      default:
        return false;
    }
  }

  /** A primitive holds no reactive identity, so a non-reactive binding of one is a snapshot. */
  private frozenValueType(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "optional") return this.frozenValueType(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.frozenValueType(member));
    return expanded.kind === "number" || expanded.kind === "string" || expanded.kind === "bool"
      || expanded.kind === "null" || expanded.kind === "enum";
  }

  /**
   * D71 rule 182: a derived value has no writable location behind it, so the
   * const message ("cannot assign to const binding") would name the wrong
   * reason. Answering here means the reader is told what a derived value is and
   * which spelling holds a value that is written.
   */
  private rejectComputedAssignment(statement: Extract<Statement, { readonly kind: "AssignmentStatement" }>): boolean {
    if (statement.target.kind !== "IdentifierExpression") return false;
    const name = statement.target.name;
    if (!this.isComputedBinding(name)) return false;
    this.diagnostics.push(diagnostic(
      "VEL5063",
      this.isImportedComputedBinding(name)
        ? `'${name}' is a computed value derived in the module it comes from, so it has no location here to assign. Export a 'state' — or an action that writes one — and change that instead`
        : `'${name}' is a computed value: it is recomputed from what it reads and is never assigned. Assign the state it reads, or declare it 'state ${name} = ...' if this value is written directly`,
      statement.target.span,
    ));
    this.inferExpression(statement.value);
    return true;
  }

  /**
   * D71 rule 183: `computed(...)` the function — the shape Vue and the signals
   * libraries teach — is not how a derived value is written here; the `computed`
   * declaration is. The declaration is recorded before the core walks the module
   * so its reads can be matched against it — the rewrite that removes the call
   * parentheses is only offered when every read is a plain `x()`.
   */
  private recordRetiredAccessorDeclaration(statement: Extract<Statement, { readonly kind: "VariableDeclaration" }>): void {
    const initializer = statement.initializer;
    if (initializer.kind !== "CallExpression" || initializer.callee.kind !== "IdentifierExpression"
      || !isRetiredAccessorName(initializer.callee.name) || this.lookup(initializer.callee.name) !== null) return;
    if (statement.binding !== "const" || statement.pattern.kind !== "NameBindingPattern") return;
    const read = initializer.arguments.length === 1 && initializer.argumentNames === undefined
      ? initializer.arguments[0]! : null;
    // Only the `() => E` shape has a body that becomes the declaration's
    // initializer verbatim. Every other argument — a named function, a partial
    // application — would need the rewriter to invent an expression, so it is
    // left to the author with the call spelled out as its only mechanical answer.
    const body = read?.kind === "ArrowFunctionExpression" && !read.asynchronous && read.parameters.length === 0
      ? read.body : null;
    this.retiredAccessorDeclarations.set(spanIdentity(statement.pattern.span), {
      name: statement.pattern.name,
      exported: statement.exported,
      readName: read?.kind === "IdentifierExpression" ? read.name : null,
      declarationSpan: statement.span,
      callSpan: initializer.span,
      bodySpan: body ? body.span : null,
    });
    this.migratedComputedCallees.add(spanIdentity(initializer.callee.span));
  }

  /** Returns true when the name is one of the retired accessor globals this pass owns. */
  private recordRetiredAccessorRead(expression: Extract<Expression, { readonly kind: "IdentifierExpression" }>): boolean {
    if (isRetiredAccessorName(expression.name)) {
      if (this.lookup(expression.name) !== null) return false;
      if (!this.migratedComputedCallees.has(spanIdentity(expression.span))) {
        this.retiredComputedReferences.set(spanIdentity(expression.span), { name: expression.name, span: expression.span });
      }
      return true;
    }
    const binding = this.lookup(expression.name);
    if (!binding) return false;
    const key = spanIdentity(binding.span);
    if (!this.retiredAccessorDeclarations.has(key)) return false;
    const reads = this.retiredAccessorReads.get(key);
    if (reads) reads.push(expression.span);
    else this.retiredAccessorReads.set(key, [expression.span]);
    return false;
  }

  /**
   * D71 migration: one message per site, and a mechanical rewrite only where
   * the compile can prove the rewrite. Where the
   * accessor is used as a value there is no second spelling left to offer, so
   * that site is told to declare the value and write an ordinary `def` where a
   * callable is what the caller wants — and it gets no edit, because moving a
   * reader out of a value position is the author's decision.
   */
  private reportRetiredComputedFunction(): void {
    for (const [key, accessor] of this.retiredAccessorDeclarations) {
      const reads = this.retiredAccessorReads.get(key) ?? [];
      const calls = reads.map((span) => this.plainCallSpans.get(spanIdentity(span)) ?? null);
      const rewritable = accessor.bodySpan !== null && calls.every((call) => call !== null);
      const edits = rewritable
        ? [
          { span: { start: accessor.declarationSpan.start, end: accessor.bodySpan!.start }, text: `${accessor.exported ? "export " : ""}computed ${accessor.name} = ` },
          { span: { start: accessor.bodySpan!.end, end: accessor.callSpan.end }, text: "" },
          ...reads.map((span, index) => ({ span: { start: span.end, end: calls[index]!.end }, text: "" })),
        ]
        : null;
      const alternative = accessor.bodySpan === null
        ? ` Where the argument is a function rather than an expression, write the call — 'computed ${accessor.name} = ${accessor.readName ?? "read"}()'`
        : ` Where the reader itself is passed on rather than read here, declare the value — 'computed ${accessor.name} = ...' — and write an ordinary 'def' where a callable is required`;
      this.diagnostics.push({
        code: "VEL5055",
        message: `A derived value is declared, not called: write 'computed ${accessor.name} = ...' and read '${accessor.name}' bare.${rewritable ? "" : alternative}`,
        span: accessor.declarationSpan,
        ...(edits ? { fix: { title: `Declare '${accessor.name}' with computed`, edits } } : {}),
      });
    }
    // There is no `fix`: the rewrite is a declaration, not a rename, and the
    // declaration form is offered above where the compile can see the whole
    // shape.
    for (const reference of this.retiredComputedReferences.values()) {
      this.diagnostics.push(diagnostic(
        "VEL5055",
        "'computed' declares a derived value — 'computed name = expression'. There is no function form, and 'computed' already caches",
        reference.span,
      ));
    }
  }


  protected override extensionFieldsOf(name: string): ReadonlyMap<string, ValueType> | null {
    return webTypeFields(name);
  }

  protected override inferExtensionCall(
    callee: import("@velarscript/compiler/extension").ExtensionValueType,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | undefined {
    if (!isWebComponentType(callee)) return undefined;
    const name = webComponentName(callee);
    this.typeError(name ? `Render component '${name}' with JSX` : "Render a Component value with JSX", callSpan);
    if (argumentNames?.some((argument) => argument !== null)) {
      this.typeError("Components use JSX props rather than named call arguments", callSpan);
    }
    for (const argument of arguments_) this.inferExpression(argument);
    return webNodeType;
  }

  protected override validateExtensionTypeSyntax(
    syntax: import("@velarscript/compiler/extension").TypeSyntax,
    validate: (syntax: import("@velarscript/compiler/extension").TypeSyntax) => boolean,
    resolve: (reference: TypeReference) => ValueType,
  ): boolean | undefined {
    if (syntax.kind !== "GenericTypeSyntax" || syntax.name !== "Component") return undefined;
    let valid = true;
    if (syntax.arguments.length < 1 || syntax.arguments.length > 2) {
      this.typeError("Component<Props, Handle> requires a named prop signature and at most one Handle type", syntax.span);
      valid = false;
    }
    const argumentsValid = syntax.arguments.map(validate).every(Boolean);
    const signature = syntax.arguments[0];
    if (!signature) return false;
    if (signature.kind !== "FunctionTypeSyntax") {
      this.typeError("Component<Props, Handle> requires a named function signature such as Component<(title: string) -> WebNode, DialogHandle>", signature.span);
      valid = false;
    } else {
      const names = new Set<string>();
      for (const parameter of signature.parameters) {
        if (!parameter.name) {
          this.typeError("Every Component signature prop requires a name", parameter.span);
          valid = false;
        } else if (names.has(parameter.name)) {
          this.typeError(`Component signature prop '${parameter.name}' is declared more than once`, parameter.span);
          valid = false;
        } else names.add(parameter.name);
        if (parameter.rest) {
          this.typeError("Component signatures use named props and cannot declare a rest parameter", parameter.span);
          valid = false;
        }
      }
      const result = resolve({ syntax: signature.result, span: signature.result.span });
      if (!isWebNodeType(result)) {
        this.typeError(`A Component signature must return WebNode, received ${describeType(result)}`, signature.result.span);
        valid = false;
      }
    }
    const handleSyntax = syntax.arguments[1];
    if (handleSyntax && argumentsValid) {
      const handle = this.expandAliases(resolve({ syntax: handleSyntax, span: handleSyntax.span }));
      const fields = handle.kind === "object"
        ? handle.fields
        : handle.kind === "named" ? this.fieldsOf(handle.identity ?? handle.name) : null;
      if (!fields) {
        this.typeError(`A Component Handle must be a concrete record type, received ${describeType(handle)}`, handleSyntax.span);
        valid = false;
      }
    }
    return valid && argumentsValid;
  }

  /**
   * D43 item 69: a component body is a construction section, not a scope with
   * an exit — its resources live until unmount. Ownership belongs to the
   * lifecycle hook or to a function inside the component, so the setup section
   * says so instead of releasing at the wrong moment.
   */
  protected override ownershipScopeRejection(): string | null {
    if (this.componentStates !== null && this.mountedDepth === 0 && this.cleanupDepth === 0 && this.watchBodyDepth === 0
      && this.inComponentSetupPosition()) {
      return "A component body builds the component and does not end, so a 'using' here has no scope to release at; own the resource inside an action, a method, or the cleanup hook";
    }
    return super.ownershipScopeRejection();
  }

  protected override invalidExtensionAwaitContext(): boolean {
    return this.synchronousReactiveDepth > 0 || this.jsxDepth > 0
      || (this.componentStates !== null && this.mountedDepth === 0);
  }

  protected override invalidExtensionAwaitMessage(): string | null {
    if (this.jsxDepth > 0) return "JSX rendering is synchronous; load async component data with a resource or await before constructing JSX";
    if (this.synchronousReactiveDepth > 0) return "Computed callbacks and watch blocks are synchronous; use resource, action, or mounted for async work";
    return "Component setup and cleanup are synchronous; use resource, action, or mounted for async work";
  }

  private componentType(statement: ComponentDeclaration): ValueType {
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, this.resolveValidatedAnnotation(parameter.type)]));
    if (!props.has("class")) props.set("class", optionalOf(stringType));
    if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
    return webComponentConstructor(
      statement.name,
      props,
      new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
      statement.handleType ? this.resolveValidatedAnnotation(statement.handleType) : null,
    );
  }

  private analyzeResourceDeclaration(statement: ResourceDeclaration): void {
    const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
    const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
    const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
    const expected: ValueType = annotationContext ? { kind: "promise", value: annotationContext } : unknownType;
    const actual = this.inferExpression(statement.initializer, expected);
    let value = annotationContext ?? unknownType;
    if (actual.kind === "promise") {
      if (annotated && annotationValid) this.requireAssignable(actual.value, annotated, statement.initializer.span);
      else if (!statement.type) value = actual.value;
    } else if (actual.kind === "any") {
      value = annotationContext ?? anyType;
    } else if (!isInvalidType(actual)) {
      this.diagnostics.push(diagnostic("VEL4016", `A resource initializer must return Promise<T>, received ${describeType(actual)}`, statement.initializer.span));
    }
    const fields = new Map<string, ValueType>([
      ["value", value.kind === "null" ? nullType : optionalOf(value)],
      ["loading", boolType],
      ["ready", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
      ["reload", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } }],
    ]);
    this.declareBinding(statement.name, false, { kind: "object", fields }, statement.span);
  }

  private actionType(statement: ActionDeclaration): ValueType {
    const declaredResult = this.resolvedAsyncResult(this.inferredFunctionResult(statement));
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "action",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveValidatedAnnotation(parameter.type)),
      parameterNames: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => parameter.name),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveValidatedAnnotation(rest.type) } : {}),
      result: { kind: "promise", value: declaredResult },
    };
  }

  private analyzeActionDeclaration(statement: ActionDeclaration): void {
    this.declareBinding(statement.name, false, this.actionType(statement), statement.span);
    this.analyzeFunctionDeclaration(statement, null, true, false, true, "Action");
  }

  private analyzeComponent(statement: ComponentDeclaration): void {
    const outerConstructorDepth = this.constructorDepth;
    if (!this.isPredeclared(statement)) this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    // VEL5075: a `def` written from here to the matching decrement lowers
    // through this component's scope, so its component elements are children.
    this.componentBodyDepth += 1;
    this.enterScope();
    this.flowFrameDepth += 1;
    const previousStates = this.componentStates;
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "ExtensionStatement:web:state").map((item) => item.name));
    const previousExplicitReadonlyProps = this.explicitReadonlyPropBindings;
    const explicitReadonlyProps = new Map<string, number>();
    // Component items are analyzed one by one rather than through
    // analyzeStatements, so the shadow prescan runs here — before the
    // parameters, whose defaults are emitted as closures inside the component
    // body where a later item's shadow would capture them.
    this.prescanScopeDeclarations(statement.body.filter((item) =>
      item.kind !== "ExtensionStatement:web:mounted" && item.kind !== "ExtensionStatement:web:cleanup" && item.kind !== "ExtensionStatement:web:expose") as readonly Statement[]);
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      const declared = valid ? type : this.resolveValidatedAnnotation(parameter.type);
      this.declareBinding(parameter.name, false, declared, parameter.span);
      if (valid && this.containsReadonlyView(declared)) explicitReadonlyProps.set(parameter.name, parameter.span.start);
      this.markDeclaredBindingReactive(parameter.name, "prop");
      if (parameter.name === "ref") this.diagnostics.push(diagnostic("VEL5056", "'ref' is a compiler-owned JSX directive and cannot be declared as a component prop", parameter.span));
    }
    this.explicitReadonlyPropBindings = explicitReadonlyProps;
    const handleType = statement.handleType ? this.resolveAnnotation(statement.handleType) : null;
    const handleTypeValid = statement.handleType ? this.validateTypeReference(statement.handleType) : true;
    if (handleType && handleTypeValid) this.validateComponentHandleType(handleType, statement.handleType!.span);
    this.constructorDepth = 0;
    let renders = 0;
    let renderValue: Expression | null = null;
    let mounted = 0;
    let cleanup = 0;
    let exposes = 0;
    for (const item of statement.body) {
      if (item.kind === "ExtensionStatement:web:state") {
        const annotationValid = item.type ? this.validateTypeReference(item.type) : true;
        const annotationContext = item.type ? this.resolveValidatedAnnotation(item.type) : null;
        const actual = this.inferExpression(item.initializer, annotationContext ?? unknownType);
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, item.initializer.span);
        this.requireSettledCollectionElement(item.initializer, declared, annotationContext !== null);
        this.declareBinding(item.name, true, declared, item.span);
        this.markDeclaredBindingReactive(item.name, "state");
      } else if (item.kind === "ExtensionStatement:web:computed") {
        this.flowFrameDepth += 1;
        this.analyzeComputedDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:resource") {
        this.flowFrameDepth += 1;
        this.analyzeResourceDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:action") {
        this.analyzeActionDeclaration(item);
      } else if (item.kind === "ExtensionStatement:web:watch") {
        this.flowFrameDepth += 1;
        this.synchronousReactiveDepth += 1;
        const watched = this.inferExpression(item.expression);
        this.rejectFrozenWatchSubject(item.expression, watched, item.currentName, item.previousName);
        this.enterScope();
        if (item.currentName) this.declareBinding(item.currentName, false, watched, item.span);
        if (item.previousName) this.declareBinding(item.previousName, false, watched, item.span);
        this.watchBodyDepth += 1;
        this.analyzeStatements(item.body);
        this.watchBodyDepth -= 1;
        this.exitScope();
        this.synchronousReactiveDepth -= 1;
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:expose") {
        exposes += 1;
        this.flowFrameDepth += 1;
        const actual = this.inferExpression(item.value, handleType ?? unknownType);
        this.flowFrameDepth -= 1;
        if (!handleType) this.diagnostics.push(diagnostic("VEL5056", `Component '${statement.name}' uses 'expose' without declaring 'exposes HandleType'`, item.span));
        else if (handleTypeValid) this.requireAssignable(actual, handleType, item.value.span);
      } else if (item.kind === "ExtensionStatement:web:mounted") {
        mounted += 1;
        this.mountedDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.mountedDepth -= 1;
      } else if (item.kind === "ExtensionStatement:web:cleanup") {
        cleanup += 1;
        // D51 (audit 12): a cleanup hook runs once and ends, so it is an
        // ordinary scope with an exit. It used to be counted as component
        // setup, and the rejection then named `@cleanup` as its own fix.
        this.cleanupDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.cleanupDepth -= 1;
      } else if (item.kind === "ReturnStatement") {
        renders += 1;
        renderValue = item.value;
        this.flowFrameDepth += 1;
        const rendered = item.value ? this.inferExpression(item.value) : nullType;
        this.flowFrameDepth -= 1;
        // WEB-U15: `return null` is the React habit for "render nothing". A
        // component always has one root, so the decision belongs to the caller.
        if (rendered.kind === "null") {
          this.typeError("A component always returns one JSX root; decide at the call site with '{show ? <Card /> : null}', or return an empty element such as <span />", item.span);
        } else if (!isWebNodeType(rendered) && rendered.kind !== "any") this.typeError("A component must return JSX", item.span);
      } else {
        this.analyzeStatement(item);
      }
    }
    if (renders !== 1) this.diagnostics.push(diagnostic("VEL5008", `Component '${statement.name}' must have exactly one top-level return`, statement.span));
    if (mounted > 1) this.diagnostics.push(diagnostic("VEL5009", `Component '${statement.name}' has more than one '@mounted' block`, statement.span));
    if (cleanup > 1) this.diagnostics.push(diagnostic("VEL5010", `Component '${statement.name}' has more than one '@cleanup' block`, statement.span));
    if (exposes > 1) this.diagnostics.push(diagnostic("VEL5056", `Component '${statement.name}' has more than one expose declaration`, statement.span));
    if (statement.handleType && exposes === 0) this.diagnostics.push(diagnostic("VEL5056", `Component '${statement.name}' declares an exposed Handle but does not provide an expose value`, statement.handleType.span));
    if (renderValue && isWebJsx(renderValue)) this.validateComponentHost(renderValue, statement);
    this.componentStates = previousStates;
    this.explicitReadonlyPropBindings = previousExplicitReadonlyProps;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.componentBodyDepth -= 1;
    this.constructorDepth = outerConstructorDepth;
  }

  private containsReadonlyView(type: ValueType): boolean {
    const resolved = this.expandAliases(type);
    if (resolved.kind === "optional") return this.containsReadonlyView(resolved.inner);
    if (resolved.kind === "union") return resolved.members.some((member) => this.containsReadonlyView(member));
    return isReadonlyView(resolved);
  }

  private validateComponentHandleType(type: ValueType, sourceSpan: Span): void {
    const expanded = this.expandAliases(type);
    const fields = expanded.kind === "object"
      ? expanded.fields
      : expanded.kind === "named" ? this.fieldsOf(expanded.identity ?? expanded.name) : null;
    if (!fields) this.diagnostics.push(diagnostic("VEL5056", `A component Handle must be a concrete record type, received ${describeType(type)}`, sourceSpan));
  }

  protected override resolveAnnotation(reference: TypeReference | null): ValueType {
    return this.normalizeComponentContracts(super.resolveAnnotation(reference));
  }

  private normalizeComponentContracts(type: ValueType): ValueType {
    if (type.kind === "optional") return optionalOf(this.normalizeComponentContracts(type.inner));
    if (type.kind === "list" || type.kind === "set") return { ...type, element: this.normalizeComponentContracts(type.element) };
    if (type.kind === "map") return { ...type, key: this.normalizeComponentContracts(type.key), value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "record") return { ...type, value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "promise" || type.kind === "runtimeType") return { ...type, value: this.normalizeComponentContracts(type.value) };
    if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, this.normalizeComponentContracts(value)])) };
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
      ...type,
      parameters: type.parameters.map((parameter) => this.normalizeComponentContracts(parameter)),
      ...(type.rest ? { rest: this.normalizeComponentContracts(type.rest) } : {}),
      result: this.normalizeComponentContracts(type.result),
    };
    if (type.kind === "union") return { kind: "union", members: type.members.map((member) => this.normalizeComponentContracts(member)) };
    if (!isWebComponentType(type)) return type;
    return normalizeWebComponentType(
      type,
      (value) => this.normalizeComponentContracts(value),
      (value) => this.normalizeComponentContracts(value),
    );
  }

  private validateComponentHost(render: JSXElementExpression, component: ComponentDeclaration): void {
    const hosts: JSXAttribute[] = [];
    const visit = (element: JSXElementExpression): void => {
      if (!/^[A-Z]/u.test(element.tag)) {
        for (const attribute of element.attributes) if (attribute.name === "host") hosts.push(attribute);
      }
      for (const child of element.children) if (child.kind === "ExtensionExpression:web:jsx") visit(child);
    };
    visit(render);
    if (hosts.length > 1) this.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' declares more than one host element`, hosts[1]!.span));
    for (const host of hosts) if (host.value !== null) this.diagnostics.push(diagnostic("VEL5043", "The host directive is a valueless marker", host.span));
    const directNativeRoot = render.tag !== "" && !/^[A-Z]/u.test(render.tag);
    const delegatedComponentRoot = /^[A-Z]/u.test(render.tag);
    if (!directNativeRoot && !delegatedComponentRoot && hosts.length === 0) {
      this.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' has multiple roots and must mark exactly one native element with 'host'`, render.span));
    }
  }

  private analyzeLookEntries(
    entries: WebLookExpression["entries"],
    insideTarget: boolean,
    nested: boolean,
    inheritedTerms: number,
    scopeKey = "",
  ): void {
    for (const entry of entries) {
      if (entry.kind === "LookSpread") {
        const type = this.inferExpression(entry.value, { kind: "named", name: "Look" });
        this.requireAssignable(type, { kind: "named", name: "Look" }, entry.value.span);
        this.reportLookSnapshotReads(entry.value);
        if (nested) this.diagnostics.push(diagnostic("VEL5044", "Look composition is only valid at the outer level; compose first, then place the result in a condition or target", entry.span));
        continue;
      }
      if (entry.kind === "LookIf") {
        this.inferLookCondition(entry.condition);
        this.reportLookSnapshotReads(entry.condition);
        const thenTerms = lookConditionTermCount(entry.condition);
        const elseTerms = lookConditionTermCount(entry.condition, true);
        if (inheritedTerms * Math.max(thenTerms, elseTerms) > LOOK_CONDITION_TERM_LIMIT) {
          this.diagnostics.push(diagnostic("VEL5045", `A Look condition may expand to at most ${LOOK_CONDITION_TERM_LIMIT} selector/runtime terms; split this visual decision into ordinary values`, entry.condition.span));
        }
        const thenKey = lookConditionKey(entry.condition, false, this.lookStaticValues);
        const elseKey = lookConditionKey(entry.condition, true, this.lookStaticValues);
        this.analyzeLookEntries(entry.thenEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * thenTerms), `${scopeKey}&${thenKey}`);
        this.analyzeLookEntries(entry.elseEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * elseTerms), `${scopeKey}&${elseKey}`);
        continue;
      }
      if (entry.kind === "LookTarget") {
        if (!LOOK_TARGETS.has(entry.name)) {
          const nearest = nearestLookName(entry.name, LOOK_TARGETS);
          this.diagnostics.push(diagnostic("VEL5038", LOOK_HOOKS.has(entry.name)
            ? `Use 'if @${entry.name}:'; '@${entry.name}' is an element state condition, not a pseudo-element target`
            : nearest
              ? `Unknown Look target '@${entry.name}'; did you mean '@${nearest}'?`
              : `Unknown Look target '@${entry.name}'; Look targets are ${[...LOOK_TARGETS].map((name) => `@${name}`).join(", ")}`, entry.span));
        }
        if (insideTarget) this.diagnostics.push(diagnostic("VEL5038", "Look targets cannot be nested", entry.span));
        // A repeated target is reported once; its body then gets a private scope
        // so the properties inside are not reported a second time as duplicates.
        const repeated = !this.recordLookEntry(`${scopeKey}#target`, entry.name);
        if (repeated) this.diagnostics.push(diagnostic("VEL5039", `Look target '@${entry.name}' is defined more than once in the same scope`, entry.span));
        this.analyzeLookEntries(entry.entries, true, true, inheritedTerms, repeated ? `${scopeKey}@${entry.name}#${entry.span.start}` : `${scopeKey}@${entry.name}`);
        continue;
      }
      this.reportLookShorthandOverlap(scopeKey, entry.name, entry.span);
      if (!this.recordLookEntry(scopeKey, entry.name)) {
        this.diagnostics.push(diagnostic("VEL5039", `Look property '${entry.name}' is defined more than once in the same scope`, entry.span));
      }
      if (!this.analyzeLookValue(entry.name, entry.value, entry.span, null)) continue;
      const expected = LOOK_PROPERTY_TYPES.get(entry.name) ?? stringType;
      const actual = this.inferExpression(entry.value, expected);
      this.reportLookSnapshotReads(entry.value);
      // Zero is the one unitless CSS length, so `padding = 0` stays legal while
      // every other bare number is answered with the unit it needs (LOK-D3).
      if (mentionsLookUnitType(expected) && lookLiteralZero(entry.value)) continue;
      if (this.reportLookNumberWithoutUnit(entry.name, actual, expected, entry.value.span)) continue;
      if (actual.kind !== "null" && expected.kind !== "unknown") this.requireAssignable(actual, expected, entry.value.span);
    }
  }

  /**
   * LOK-D1: a `look:` literal is constructed once, where it is written. Its
   * conditions and its values are snapshot positions — a reactive read inside
   * one compiles cleanly and then never updates, which is the quietest trap in
   * the visual language. The two spellings that stay live are the JSX
   * expression position and the `look:property` directive, so the read is
   * rejected here and both are taught.
   */
  private reportLookSnapshotReads(expression: Expression): void {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "IdentifierExpression" && typeof record.name === "string") {
        const name = record.name;
        const reactive = this.reactiveBindingKind(name) !== null || this.derivedReactiveRead(name);
        if (reactive) {
          this.diagnostics.push(diagnostic(
            "VEL5058",
            `A Look literal is built once where it is written, so '${name}' is read as a snapshot and the visual never follows it. Put the reactive decision on the element instead: 'look={${name} ? oneLook : otherLook}' chooses a whole Look, and 'look:property={...}' sets one property`,
            record.span as Span,
          ));
        }
        return;
      }
      for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
    };
    visit(expression);
  }

  /**
   * True when a name both belongs to a derived reactive declaration and still
   * resolves to one here: a computed accessor is a zero-argument function, and a
   * resource or action handle is a record with its reactive fields. An ordinary
   * binding that happens to share the name — a function parameter, a local — is
   * not a reactive read.
   */
  private derivedReactiveRead(name: string): boolean {
    if (!this.derivedReactiveNames.has(name)) return false;
    const binding = this.lookup(name);
    if (!binding) return false;
    const type = this.expandAliases(binding.type);
    if (type.kind === "function" || type.kind === "action") return type.parameters.length === 0 && !type.rest;
    return type.kind === "object" && (type.fields.has("reload") || type.fields.has("pending"));
  }

  /**
   * LOK-U8: the velar/look builders check their numeric domains at run time, so
   * a literal out-of-range colour used to compile clean and blank the page on
   * the first paint. Literal arguments are checked in the same terms while the
   * module compiles; dynamic arguments keep the runtime guard.
   */
  private checkLookBuilderCall(expression: Extract<Expression, { kind: "CallExpression" }>): void {
    const builder = expression.callee.kind === "IdentifierExpression"
      ? this.lookBuilderNames.get(expression.callee.name)
      : undefined;
    if (!builder) return;
    const key = spanIdentity(expression.span);
    if (this.checkedBuilderCalls.has(key)) return;
    this.checkedBuilderCalls.add(key);
    if (builder === "animate") {
      this.checkAnimateBuilderCall(expression);
      return;
    }
    if (builder === "token") {
      this.checkLookTokenCall(expression);
      return;
    }
    const ranges = LOOK_BUILDER_NUMERIC_RANGES.get(builder);
    // A named argument fills the same slot its positional spelling does, so the
    // position comes from the builder's own signature — the one table the
    // module interface, the named-argument arity check, and the `keyframes:`
    // lowering already derive from. Reading `-1` here instead put every check
    // in this loop out of reach of the named spelling, not only the range
    // table: `rgba(0, 0, 0, alpha=2)` compiled clean while `rgba(0, 0, 0, 2)`
    // was refused.
    const parameters = LOOK_BUILDER_SIGNATURES.get(builder)?.parameters;
    for (const [index, argument] of expression.arguments.entries()) {
      const named = expression.argumentNames?.[index] ?? null;
      const position = named === null ? index : parameters?.indexOf(named) ?? -1;
      const range = position >= 0 ? ranges?.[position] : undefined;
      // LOK-U8 completed: a `keyframes:` stop lowers its builder calls at
      // compile time, so no call survives to run the runtime guard. Reading the
      // folded value rather than the literal node is what makes the promise
      // "a computed argument keeps the same check" true where the run time the
      // charter names does not exist.
      const folded = evaluateLookStaticExpression(argument, this.lookStaticValues);
      const literal = folded?.kind === "number" ? folded.value : null;
      if (range && literal !== null && (literal < range[1] || literal > range[2])) {
        this.diagnostics.push(diagnostic("VEL5042", `${range[0]} must be from ${range[1]} through ${range[2]}; ${builder} received ${literal}`, argument.span));
      }
      // LOK-D3, builder half: a unitless number in a length position is dead
      // CSS exactly as it is on a property. Zero is the one unitless length.
      if (LOOK_LENGTH_BUILDERS.has(builder) && literal !== null && literal !== 0
        && !(builder === "border" && position !== 0) && !(builder === "shadow" && position === 5)) {
        this.diagnostics.push(diagnostic(
          "VEL5042",
          `${builder} composes CSS lengths, so ${literal} requires a unit; write a unit value such as ${literal}px or ${literal}rem (only 0 is unitless)`,
          argument.span,
        ));
      }
      if (builder === "border" && position === 2 && argument.kind === "LiteralExpression" && typeof argument.value === "string"
        && !LOOK_BORDER_STYLE_NAMES.has(argument.value)) {
        this.diagnostics.push(diagnostic("VEL5042", `Border style '${argument.value}' is not a CSS border style; use one of ${[...LOOK_BORDER_STYLE_NAMES].join(", ")}`, argument.span));
      }
      // D60 rule 150 gave `transitionProperty` a real vocabulary and the
      // charter says the builder takes the same one. It took none, so the
      // longhand's refusal taught the camelCase spelling the builder accepted
      // and the browser discarded. Routing the argument through the property's
      // own checker keeps one vocabulary and one message.
      if (builder === "transition" && position === 0) {
        this.validateLookStringVocabulary("transitionProperty", argument, "The transition builder's property argument");
      }
      // D103 rule 4: one spelling. `color(string)` used to be the only checked
      // Look value that let a design token through, and it let it through as
      // text nobody read — so the same reference was legal on `color` and
      // refused on `width`, and the accepting half checked nothing.
      if (builder === "color" && position === 0) this.reportLookColorVarReference(expression, argument);
    }
    if (builder === "tracks" && expression.arguments.length > 1024) {
      this.diagnostics.push(diagnostic("VEL5042", "tracks cannot contain more than 1024 values", expression.span));
    }
  }

  /**
   * D103 rules 1 and 5 — what a checked token reference has to be at the site
   * that writes it.
   *
   * The compiler cannot see a design system's values: no token stylesheet is an
   * input to this compile, and the whole point of the contract is that the
   * theme swaps values under the same names. So the reference itself is the
   * only thing there is to check, and it is checked completely — a literal
   * name, spelled as a CSS custom property identifier, and nothing else in the
   * call. A computed name would leave a Look value with no checked part at all,
   * which is the surface D50 rule 92 says is worse than none.
   */
  private checkLookTokenCall(expression: Extract<Expression, { kind: "CallExpression" }>): void {
    const names = expression.argumentNames;
    // `token(name="--x")` writes the same one argument the positional spelling
    // does, so the name position is read from the signature the way every other
    // builder's is rather than assumed to be index 0.
    const position = names?.findIndex((entry) => entry === "name") ?? -1;
    const nameIndex = position >= 0 ? position : names?.[0] === undefined || names[0] === null ? 0 : -1;
    for (const [index, argument] of expression.arguments.entries()) {
      if (index === nameIndex) continue;
      this.diagnostics.push(diagnostic("VEL5042", LOOK_TOKEN_NO_FALLBACK_GUIDANCE, argument.span));
    }
    const written = nameIndex >= 0 ? expression.arguments[nameIndex] : undefined;
    if (!written) return;
    if (written.kind !== "LiteralExpression" || typeof written.value !== "string") {
      this.diagnostics.push(diagnostic(
        "VEL5042",
        `A design token reference names its custom property in the call: ${LOOK_TOKEN_NAME_RULE}. The compiler cannot see a design system's values, so the name is the whole of what it can check — a computed name, an interpolation, or a binding would leave the reference unchecked`,
        written.span,
      ));
      return;
    }
    if (isLookTokenName(written.value)) {
      // D103 rule 2: the reference is compile-time text, so it is folded here
      // rather than left as a call the browser makes on every module load. The
      // fold is stamped only on a call this check has just proved, which is
      // what keeps the emitter structurally unable to write a name nothing
      // validated. An aliased builder (`const t = token`) is not resolved here
      // and keeps the runtime implementation, exactly as every other builder
      // passed around as a value does.
      if (expression.arguments.length === 1) {
        this.extensionLiterals.set(spanIdentity(expression.span), lookTokenReference(written.value));
      }
      return;
    }
    // A name written without the `--` that makes it a custom property is the
    // one near miss with a single spelling behind it, so it is migrated rather
    // than only refused.
    const prefixed = `--${written.value}`;
    this.diagnostics.push(diagnostic(
      "VEL5042",
      `Design token name '${written.value}' is not a CSS custom property identifier; ${LOOK_TOKEN_NAME_RULE}`,
      written.span,
      isLookTokenName(prefixed)
        ? mechanicalFix(written.span, JSON.stringify(prefixed), `Use "${prefixed}"`)
        : undefined,
    ));
  }

  /**
   * D103 rule 4 — the migration off the one passthrough that used to work.
   *
   * The rewrite carries the `token` import when the module does not already
   * have one, because a fix that leaves a module naming an unimported builder
   * is not mechanical. A `var(--x, fallback)` reference has no rewrite: rule 5
   * closed the contract against per-site fallbacks, so the message says that
   * rather than offering a migration that would silently drop the fallback.
   */
  private reportLookColorVarReference(
    expression: Extract<Expression, { kind: "CallExpression" }>,
    argument: Expression,
  ): void {
    if (argument.kind !== "LiteralExpression" || typeof argument.value !== "string") return;
    if (!isLookVarReference(argument.value)) return;
    const referenced = lookVarReferenceName(argument.value);
    if (referenced === null) {
      this.diagnostics.push(diagnostic(
        "VEL5042",
        `A design token reference is written token("--name"), and it carries no fallback: ${LOOK_TOKEN_NO_FALLBACK_GUIDANCE}`,
        argument.span,
      ));
      return;
    }
    const { call, imported } = this.lookTokenCallText(referenced);
    const rewrite: DiagnosticEdit = { span: expression.span, text: call };
    this.diagnostics.push(diagnostic(
      "VEL5042",
      `Write a design token reference as ${call}; color("var(...)") passed the reference through as text nothing checked, and token() is the one checked spelling — legal in every Look property, not only the colour ones`,
      expression.span,
      mechanicalEdits(imported ? [rewrite] : [this.lookTokenImportEdit(), rewrite], `Use ${call}`),
    ));
  }

  /** The one edit that gives this module a `token` import, in the shape D103's migration needs. */
  private lookTokenImportEdit(): DiagnosticEdit {
    const site = this.lookImport ?? { declaration: null, insertAt: 0, leadingBlankLine: true };
    const specifiers = [...(site.declaration?.specifiers ?? []), { imported: "token", local: "token" }];
    const line = `import {${[...specifiers]
      .sort((left, right) => byCodeUnit(left.imported, right.imported))
      .map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`)
      .join(", ")}} from "velar/look"`;
    if (site.declaration) return { span: site.declaration.span, text: line };
    return { span: { start: site.insertAt, end: site.insertAt }, text: site.leadingBlankLine ? `${line}\n\n` : `\n${line}` };
  }

  private checkAnimateBuilderCall(expression: Extract<Expression, { kind: "CallExpression" }>): void {
    const argument = (name: string, position: number): Expression | null => {
      const named = expression.argumentNames?.findIndex((candidate) => candidate === name) ?? -1;
      if (named >= 0) return expression.arguments[named] ?? null;
      const sourceName = expression.argumentNames?.[position];
      return sourceName === null || sourceName === undefined ? expression.arguments[position] ?? null : null;
    };
    const duration = argument("duration", 1);
    const delay = argument("delay", 3);
    const count = argument("count", 4);
    const loop = argument("loop", 5);
    const easing = argument("easing", 2);
    const direction = argument("direction", 6);
    const fill = argument("fill", 7);
    const durationValue = lookDurationLiteral(duration);
    const delayValue = lookDurationLiteral(delay);
    if (durationValue !== null && durationValue <= 0) {
      this.diagnostics.push(diagnostic("VEL5060", "Animation duration must be greater than zero", duration!.span));
    }
    if (delayValue !== null && delayValue < 0) {
      this.diagnostics.push(diagnostic("VEL5060", "Animation delay cannot be negative", delay!.span));
    }
    const countValue = numericLiteral(count);
    if (countValue !== null && (!Number.isInteger(countValue) || countValue <= 0 || countValue > 1_000_000)) {
      this.diagnostics.push(diagnostic("VEL5060", "Animation count must be a positive integer no greater than 1000000", count!.span));
    }
    if (count && loop) {
      this.diagnostics.push(diagnostic("VEL5060", "animate accepts either count or loop, not both: count names the number of runs, and loop=true replaces that count with an unbounded one", expression.span));
    }
    this.checkAnimationKeyword(easing, "easing", LOOK_ANIMATION_EASINGS);
    this.checkAnimationKeyword(direction, "direction", LOOK_ANIMATION_DIRECTIONS);
    this.checkAnimationKeyword(fill, "fill", LOOK_ANIMATION_FILLS);
  }

  private checkAnimationKeyword(value: Expression | null, name: string, vocabulary: ReadonlySet<string>): void {
    if (!value || value.kind !== "LiteralExpression" || typeof value.value !== "string") return;
    if (!vocabulary.has(value.value)) {
      this.diagnostics.push(diagnostic("VEL5060", `Animation ${name} '${value.value}' is not supported; use one of ${[...vocabulary].join(", ")}`, value.span));
    }
  }

  private analyzeKeyframes(expression: WebKeyframesExpression): void {
    for (const stop of expression.stops) {
      const properties = new Set<string>();
      for (const entry of stop.entries) {
        if (properties.has(entry.name)) {
          this.diagnostics.push(diagnostic("VEL5039", `Keyframe property '${entry.name}' is defined more than once at the same stop`, entry.span));
          continue;
        }
        properties.add(entry.name);
        if (LOOK_NON_ANIMATABLE_PROPERTIES.has(entry.name)) {
          this.diagnostics.push(diagnostic("VEL5060", `Look property '${entry.name}' does not participate in animation interpolation`, entry.span));
          this.inferExpression(entry.value);
          continue;
        }
        if (!this.analyzeLookValue(entry.name, entry.value, entry.span, null)) continue;
        const expected = LOOK_PROPERTY_TYPES.get(entry.name) ?? stringType;
        const actual = this.inferExpression(entry.value, expected);
        this.reportKeyframeSnapshotReads(entry.value);
        if (keyframeCssValue(entry.value, this.lookStaticValues) === null) {
          this.diagnostics.push(diagnostic(
            "VEL5060",
            "A keyframe value must resolve to static CSS from literals, unit values, arithmetic, velar/look builders, or const bindings — local or imported — that hold any of those, and the text it resolves to must read as one declaration value: no ';', '{', '}', or '@' outside a string, with parentheses, strings, and comments all closed",
            entry.value.span,
          ));
        }
        if (mentionsLookUnitType(expected) && lookLiteralZero(entry.value)) continue;
        if (this.reportLookNumberWithoutUnit(entry.name, actual, expected, entry.value.span)) continue;
        if (actual.kind !== "null" && expected.kind !== "unknown") this.requireAssignable(actual, expected, entry.value.span);
      }
    }
  }

  private reportKeyframeSnapshotReads(expression: Expression): void {
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.kind === "IdentifierExpression" && typeof record.name === "string") {
        const name = record.name;
        if (this.reactiveBindingKind(name) !== null || this.derivedReactiveRead(name)) {
          this.diagnostics.push(diagnostic(
            "VEL5060",
            `Keyframes generate static CSS, so reactive '${name}' cannot be read inside a stop; make animation presence dynamic with look:animation={condition ? animate(frames, 1s) : null}`,
            record.span as Span,
          ));
        }
        return;
      }
      for (const [key, child] of Object.entries(record)) if (key !== "span") visit(child);
    };
    visit(expression);
  }

  /**
   * D104 rule 2 — the wider half of the promise VEL5039 already made. A
   * repeated property name is refused because the second entry overwrites the
   * first and Look has no source order to settle which is meant; a shorthand
   * beside a longhand it writes is the same defect with two spellings, and it
   * is the one that hid thirty-six dead declarations in a consumer's shell.
   * Reports once against the entry that completes the pair.
   */
  private reportLookShorthandOverlap(scopeKey: string, name: string, span: Span): void {
    for (const other of this.lookEntryScopes.get(scopeKey) ?? []) {
      const overlap = lookShorthandOverlap(other, name);
      if (!overlap) continue;
      this.diagnostics.push(diagnostic("VEL5039", lookShorthandOverlapMessage(overlap.shorthand, overlap.longhand, "This Look scope"), span));
      return;
    }
  }

  /**
   * The same rule where the properties are written as element directives. A
   * `look:` directive lowers to exactly the rule a block entry does, so an
   * element carrying `look:padding` and `look:paddingTop` has the pair in the
   * same scope as surely as a block does. The `style:` directives are not
   * checked here: they compose one inline style object, where the browser's own
   * source order settles the pair.
   */
  private reportLookDirectiveOverlap(expression: JSXElementExpression): void {
    const written: string[] = [];
    for (const attribute of expression.attributes) {
      if (!attribute.name.startsWith("look:")) continue;
      const property = attribute.name.slice("look:".length);
      if (!LOOK_PROPERTIES.has(property)) continue;
      const overlapping = written.map((other) => lookShorthandOverlap(other, property)).find(Boolean);
      if (overlapping) {
        this.diagnostics.push(diagnostic("VEL5039", lookShorthandOverlapMessage(overlapping.shorthand, overlapping.longhand, `Element '<${expression.tag}>'`), attribute.span));
      }
      written.push(property);
    }
  }

  /**
   * Records one entry in its lowered scope (condition signature plus target) so
   * two sibling blocks with the same condition report the property they both
   * set. Returns false when the entry repeats. LOK-I4: the charter's duplicate
   * promise used to hold only inside a single indented scope.
   */
  private recordLookEntry(scopeKey: string, name: string): boolean {
    const seen = this.lookEntryScopes.get(scopeKey) ?? new Set<string>();
    this.lookEntryScopes.set(scopeKey, seen);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  }

  /**
   * The vocabulary checks a Look property shares between the block spelling and
   * the `look:`/`style:` directives. Returns false when the entry is already
   * reported and its value needs no further checking. LOK-I1: an unrecognized
   * property no longer co-reports a `stringType` fallback assignment error.
   */
  private analyzeLookValue(name: string, value: Expression, entrySpan: Span, directive: "look" | "style" | null): boolean {
    const inline = directive !== null;
    const label = directive === "style" ? "inline Style" : directive === "look" ? "inline Look" : "Look";
    if (name === "animation" && value.kind === "LiteralExpression" && typeof value.value === "string") {
      this.diagnostics.push(diagnostic(
        "VEL5038",
        "Look animation does not accept CSS shorthand text; declare a checked 'keyframes:' value and pass animate(frames, duration, ...) instead",
        entrySpan,
      ));
      if (!inline) this.inferExpression(value);
      return false;
    }
    // D103 rule 1 meets D49. `animation` is the one Look property whose value
    // names another rule rather than describing one: the `@keyframes` name in
    // an animation shorthand. Look owns those names — they are generated from
    // the `keyframes:` value that defines the motion — so a shorthand arriving
    // from outside this compile is a reference the compiler can check on
    // neither side, which is the surface D50 rule 92 calls worse than none. The
    // type refuses it either way; this replaces a bare union dump with the two
    // spellings that do work.
    if (name === "animation" && this.isLookTokenCall(value)) {
      this.diagnostics.push(diagnostic(
        "VEL5038",
        "Look animation is the one property a design token cannot carry: an animation value names a '@keyframes' rule, and Look generates those names from the 'keyframes:' value that defines the motion, so a shorthand from a design system names a rule this compile never emitted. Declare a checked 'keyframes:' value and pass animate(frames, duration, ...); token() is legal in every other Look property, and a module-level 'import css unsafe \"./styles.css\" before look' carries a design system's own animation when that boundary is intentional",
        entrySpan,
      ));
      if (!inline) this.inferExpression(value);
      return false;
    }
    if (!LOOK_PROPERTIES.has(name)) {
      const nearest = nearestLookName(name, LOOK_PROPERTIES);
      const exclusion = LOOK_EXCLUDED_PROPERTIES.get(name);
      this.diagnostics.push(diagnostic("VEL5038", exclusion
        ? `CSS property '${name}' is outside checked Look: ${exclusion}. Use a module-level 'import css unsafe "./styles.css" before look' when that boundary is intentional`
        : nearest
          ? `Unknown ${label} property '${name}'; did you mean '${nearest}'?`
          : `Unknown ${label} property '${name}'; ${inline ? `${directive!}:* uses the same camelCase property names as a Look block` : "Look properties use the DOM camelCase spelling of a CSS property"}`, entrySpan));
      if (!inline) this.inferExpression(value);
      return false;
    }
    const shorthandGuidance = lookShorthandStringGuidance(name, value);
    if (shorthandGuidance) {
      this.diagnostics.push(diagnostic("VEL5038", shorthandGuidance, value.span));
      return false;
    }
    const site: LookValueSite = { property: name, entrySpan, directive };
    this.adviseLookTokenSpelling(name, value, site);
    if (!this.validateLookStringVocabulary(name, value, undefined, site)) return false;
    return true;
  }

  /** Whether this value is written as a call to the module's `token` builder, alias included. */
  private isLookTokenCall(value: Expression): boolean {
    return value.kind === "CallExpression" && value.callee.kind === "IdentifierExpression"
      && this.lookBuilderNames.get(value.callee.name) === "token";
  }

  /** How this module spells a call to the token builder, honouring an aliased import. */
  private lookTokenCallText(referenced: string): { readonly call: string; readonly imported: boolean } {
    const local = [...this.lookBuilderNames].find(([, builder]) => builder === "token")?.[0] ?? null;
    return { call: `${local ?? "token"}(${JSON.stringify(referenced)})`, imported: local !== null };
  }

  /**
   * The edits that replace one written Look value with the checked token call,
   * in the spelling of the site that wrote it.
   *
   * A `look:property="text"` directive is analyzed through a synthetic literal
   * standing for the whole attribute, so the rewrite replaces the attribute:
   * splicing a call between an attribute's quotes is not JSX, and a fix that
   * produces a parse error is not a mechanical fix. The `look:property={...}`
   * spelling carries a real expression whose span is the value alone, and is
   * rewritten in place like a block entry.
   */
  private lookTokenRewrite(value: Expression, referenced: string, site: LookValueSite): readonly DiagnosticEdit[] {
    const { call, imported } = this.lookTokenCallText(referenced);
    const wholeAttribute = site.directive !== null
      && value.span.start === site.entrySpan.start && value.span.end === site.entrySpan.end;
    const edit: DiagnosticEdit = {
      span: value.span,
      text: wholeAttribute ? `${site.directive!}:${site.property}={${call}}` : call,
    };
    return imported ? [edit] : [this.lookTokenImportEdit(), edit];
  }

  /**
   * D103 rule 4, free-text half — an advisory rather than a refusal.
   *
   * `fontFamily`, `backdropFilter` and the other free-text kinds accept
   * arbitrary CSS text by construction, and a `var()` inside a larger value is
   * a legitimate spelling with no single token to rewrite it to: the tail of a
   * font stack, one layer of a filter list. Refusing there would refuse real
   * CSS. What is advised is the narrow case where the *whole* value is one
   * reference, because there `token("--name")` is the checked spelling of the
   * same thing and the rewrite is unambiguous — which is the bar the `A`
   * roster is written to.
   */
  private adviseLookTokenSpelling(name: string, value: Expression, site: LookValueSite): void {
    const kind = LOOK_PROPERTY_VALUE_KINDS.get(name);
    if (kind !== "text" && kind !== "filter" && kind !== "transform") return;
    if (value.kind !== "LiteralExpression" || typeof value.value !== "string") return;
    const referenced = lookVarReferenceName(value.value);
    if (referenced === null) return;
    const { call } = this.lookTokenCallText(referenced);
    this.advise(
      "A12",
      `Look property '${name}' accepts free text, so this design token reference compiles — as text nothing checks. ${call} is the checked spelling of the same reference, and it is legal in every Look property. A var() inside a larger value, such as a font stack's fallback, has no single token to stand for it and is not advised`,
      value.span,
      mechanicalEdits(this.lookTokenRewrite(value, referenced, site), `Use ${call}`),
    );
  }

  /**
   * `subject` names the position in the message. It is the property itself
   * everywhere except the `transition(...)` builder, whose first argument takes
   * `transitionProperty`'s vocabulary but is not written as that property — a
   * refusal that named the longhand there would name a spelling the author
   * never wrote.
   */
  private validateLookStringVocabulary(name: string, value: Expression, subject = `Look property '${name}'`, site?: LookValueSite): boolean {
    const kind = LOOK_PROPERTY_VALUE_KINDS.get(name);
    if (!kind || kind === "text" || kind === "filter" || kind === "transform" || kind === "animation") return true;
    const values = literalStringValues(value) ?? this.foldedLookKeyword(value);
    if (values === null) return true;
    for (const text of values) {
      const normalized = text.trim();
      // D103 rule 4: this is the refusal the shell wave met — every metric,
      // shadow and transition property turned a design token reference away and
      // named `import css unsafe` as the only way out, which is how a product's
      // whole visual layer ended up outside Look. The reference is still
      // refused as free text, because free text is what it was; what changed is
      // that the refusal now names the checked spelling of the same reference
      // and rewrites to it.
      const referenced = site && lookVarReferenceName(normalized);
      if (referenced) {
        const { call } = this.lookTokenCallText(referenced);
        this.diagnostics.push(diagnostic(
          "VEL5038",
          `${subject} does not accept the text '${normalized}'; write the design token reference as ${call}, which is checked and legal in every Look property`,
          value.span,
          mechanicalEdits(this.lookTokenRewrite(value, referenced, site), `Use ${call}`),
        ));
        return false;
      }
      if (kind === "metric" && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%|fr|ms|s|deg|turn)$/u.test(normalized)) {
        this.diagnostics.push(diagnostic(
          "VEL5038",
          `Use the unit literal ${normalized}; quoted unit values are not part of Look`,
          value.span,
        ));
        return false;
      }
      let accepted: boolean;
      // A metric property is a unit value plus a keyword half: its own CSS
      // keywords when it has a table -- `backgroundSize` takes lengths *and*
      // cover and contain, the `<position>` properties take the placement words
      // (D60 rule 150, D67 rule 172) -- and the shared sizing words when it has
      // none. The two are alternatives rather than a union, for the reason D65
      // rule 168 gave for the keyword kind: a shared list added on top of a
      // real table decides values for a property it has never heard of, so
      // `objectPosition = "min-content"` would compile and reach the browser as
      // a declaration it discards.
      const metricKeywords = LOOK_PROPERTY_KEYWORDS.get(name);
      if (kind === "metric") accepted = metricKeywords === undefined ? lookMetricKeywords.has(normalized) : metricKeywords.has(normalized);
      else if (kind === "color" || kind === "background") accepted = lookColorKeywords.has(normalized) || /^#[0-9a-f]{3,8}$/iu.test(normalized);
      else if (kind === "image") accepted = lookCssWideKeywords.has(normalized) || normalized === "none";
      // D73 rule 187: every kind that decides a string keyword reads the
      // property's own closed set, and look.ts refuses to load if one is
      // missing. The 46-word shared list this replaces both admitted values the
      // property never had and made the refusal describe a table that did not
      // exist.
      else accepted = LOOK_PROPERTY_KEYWORDS.get(name)?.has(normalized) === true;
      if (!accepted) {
        // D67 rule 174, widened by D73 rule 187: every refusal now names the
        // property's own values, because every one of these kinds has them. The
        // lead says what the non-keyword half of the property is, so a reader
        // who wanted a length, an angle or a builder is not sent looking through
        // a keyword list for it.
        const expected: LookValueGuidance = kind === "metric"
          ? lookVocabularyGuidance(name, normalized,
            metricKeywords === undefined ? LOOK_SHARED_METRIC_KEYWORDS : lookOwnKeywords(name),
            "write a unit value such as 16px, 1rem or 50%, or one of")
          : kind === "color" || kind === "background"
            ? { text: "use a checked color() or color keyword", named: false }
            : kind === "image"
              ? { text: "use a checked image builder such as linearGradient() or asset()", named: false }
              : lookVocabularyGuidance(name, normalized, lookOwnKeywords(name), lookVocabularyLead(kind));
        // D65 rule 169: a property whose CSS value space no set can hold says
        // what it left out, so the boundary is legible where it is met.
        const partial = expected.named ? undefined : LOOK_PARTIAL_KEYWORD_PROPERTIES.get(name);
        this.diagnostics.push(diagnostic("VEL5038", `${subject} does not accept '${normalized}'; ${expected.text}${partial
          ? `. ${partial}; use a module-level 'import css unsafe "./styles.css" before look' when that boundary is intentional`
          : ""}`, value.span));
        return false;
      }
    }
    return true;
  }

  /**
   * D65 rule 168 closed the closed sets against misspelled literals, and D65
   * item 3 makes a `const` string a first-class design token — so the two have
   * to agree. A name or a record field that folds to a bare CSS keyword is
   * checked exactly as the literal spelling of it is; anything that folds to
   * composed CSS text (a builder result, a unit, a gradient) is not a keyword
   * and is left to the type and to the builder's own checks.
   */
  private foldedLookKeyword(value: Expression): readonly string[] | null {
    if (value.kind !== "IdentifierExpression" && value.kind !== "MemberExpression") return null;
    const folded = evaluateLookStaticExpression(value, this.lookStaticValues);
    if (folded?.kind !== "css" || !/^[A-Za-z][A-Za-z0-9-]*$/u.test(folded.value)) return null;
    return [folded.value];
  }

  /**
   * LOK-D3: a bare number on a length property reaches CSS as a declaration the
   * browser discards. The union already rejects it; this diagnostic replaces the
   * union dump with the unit the author meant to write.
   */
  private reportLookNumberWithoutUnit(name: string, actual: ValueType, expected: ValueType, valueSpan: Span): boolean {
    if (this.expandAliases(actual).kind !== "number" || LOOK_UNITLESS_PROPERTIES.has(name)) return false;
    if (!mentionsLookUnitType(expected)) return false;
    this.diagnostics.push(diagnostic(
      "VEL5038",
      `Look property '${name}' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%`,
      valueSpan,
    ));
    return true;
  }

  private inferLookCondition(expression: Expression): ValueType {
    if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") {
      if (!LOOK_HOOKS.has(expression.name)) {
        // LOK-I2: the target position redirects a hook to 'if @hook:', so the
        // condition position redirects a target to its block spelling.
        const nearest = nearestLookName(expression.name, LOOK_HOOKS);
        this.diagnostics.push(diagnostic("VEL5038", LOOK_TARGETS.has(expression.name)
          ? `Use '@${expression.name}:' as a target block; '@${expression.name}' is a pseudo-element target, not an element state condition`
          : nearest
            ? `Unknown Look hook '@${expression.name}'; did you mean '@${nearest}'?`
            : `Unknown Look hook '@${expression.name}'; Look hooks are ${[...LOOK_HOOKS].map((name) => `@${name}`).join(", ")}`, expression.span));
      }
      return boolType;
    }
    if (expression.kind === "UnaryExpression" && expression.operator === "not") {
      const value = this.inferLookCondition(expression.operand);
      this.requireCondition(value, expression.operand);
      return boolType;
    }
    if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
      const left = this.inferLookCondition(expression.left);
      const right = this.inferLookCondition(expression.right);
      this.requireCondition(left, expression.left);
      this.requireCondition(right, expression.right);
      return boolType;
    }
    if (isViewportComparison(expression)) {
      const comparison = expression as Extract<Expression, { kind: "BinaryExpression" }>;
      this.inferExpression(comparison.right, lookLength);
      this.checkViewportThreshold(comparison.right);
      return boolType;
    }
    const flipped = flippedViewportComparison(expression);
    if (flipped) {
      this.inferExpression(flipped.threshold, lookLength);
      this.diagnostics.push(diagnostic(
        "VEL5052",
        `Write the viewport on the left of a breakpoint: 'viewport.${flipped.property} ${flipped.operator} ${lookSourceOf(flipped.threshold)}'`,
        expression.span,
      ));
      this.checkViewportThreshold(flipped.threshold);
      return boolType;
    }
    if (isSchemeCondition(expression)) return boolType;
    // LOK-U3: the media-subject set is closed. A subject the reader reached for
    // and Look does not carry names the whole set instead of reporting the
    // subject as an unknown Core name. A comparison carries its subject on
    // either side, so both operands are examined.
    const operands = expression.kind === "BinaryExpression" ? [expression.left, expression.right] : [expression];
    for (const operand of operands) {
      const subject = mediaSubjectShape(operand);
      if (!subject || this.lookup(subject.subject)) continue;
      if (!LOOK_MEDIA_SUBJECTS.has(subject.subject) && !LOOK_ABSENT_MEDIA_SUBJECTS.has(subject.subject)) continue;
      this.diagnostics.push(diagnostic(
        "VEL5038",
        `Look media conditions are ${lookMediaVocabulary()}; '${subject.subject}.${subject.feature}' is not one of them`,
        expression.span,
      ));
      return boolType;
    }
    const type = this.inferExpression(expression);
    this.requireCondition(type, expression);
    return boolType;
  }

  private checkViewportThreshold(value: Expression): void {
    const threshold = evaluateLookStaticExpression(value, this.lookStaticValues);
    if (threshold?.kind !== "unit") {
      this.diagnostics.push(diagnostic(
        "VEL5052",
        "A viewport breakpoint must resolve at compile time to a px, rem, or em value; use a const unit token or an imported const unit token",
        value.span,
      ));
    } else if (!LOOK_MEDIA_LENGTH_UNITS.has(threshold.unit)) {
      this.diagnostics.push(diagnostic("VEL5052", `Viewport breakpoints do not support '${threshold.unit}'; use px, rem, or em`, value.span));
    }
  }

  private inferJsx(expression: JSXElementExpression): ValueType {
    this.jsxDepth += 1;
    const attributes = new Map(expression.attributes.map((attribute) => [attribute.name, attribute]));
    const component = /^[A-Z]/u.test(expression.tag);
    if (expression.tag && !component && !WEB_NATIVE_ELEMENTS.has(expression.tag) && !isWebCustomElementName(expression.tag)) {
      const nearest = nearestLookName(expression.tag, WEB_NATIVE_ELEMENTS);
      this.diagnostics.push(diagnostic(
        "VEL5061",
        nearest
          ? `Unknown native element '<${expression.tag}>'; did you mean '<${nearest}>'?`
          : `Unknown native element '<${expression.tag}>'; use a standard HTML, SVG, or MathML element, or a lowercase hyphenated custom element such as '<user-card>'`,
        expression.tagSpan,
      ));
    }
    if (attributes.size !== expression.attributes.length) this.diagnostics.push(diagnostic("VEL5014", `JSX element '${expression.tag}' has duplicate attributes`, expression.span));
    this.reportLookDirectiveOverlap(expression);
    for (const attribute of expression.attributes) {
      if (removedJsxControlAttributes.has(attribute.name)) {
        this.diagnostics.push(diagnostic("VEL5029", `JSX '${attribute.name}' was removed; branch with an ordinary expression such as {condition ? <A /> : <B />}`, attribute.span));
      }
    }
    if (expression.tag && !component) {
      for (const attribute of expression.attributes) if (!removedJsxControlAttributes.has(attribute.name)) this.analyzeNativeJsxAttribute(expression, attribute);
      if (attributes.has("unsafe:html") && expression.children.length > 0) this.diagnostics.push(diagnostic("VEL5015", "unsafe:html cannot be combined with JSX children", expression.span));
      if (expression.tag === "img" && !attributes.has("alt")) this.diagnostics.push(diagnostic("VEL5016", "An img element requires an alt attribute", expression.span));
      if (expression.tag === "button" && !attributes.has("aria-label") && !attributes.has("aria-labelledby") && !hasAccessibleJsxContent(expression)) this.diagnostics.push(diagnostic("VEL5026", "A button requires text content, aria-label, or aria-labelledby", expression.span));
      if (expression.tag === "svg" && !hasAccessibleSvgName(expression)) this.diagnostics.push(diagnostic("VEL5030", "An svg element requires a non-empty title, aria-label, aria-labelledby, or aria-hidden='true'", expression.span));
      if (expression.tag === "a" && !attributes.has("href")) this.diagnostics.push(diagnostic("VEL5027", "A native anchor requires href; use a button for actions", expression.span));
      const target = attributes.get("target")?.value;
      const relation = attributes.get("rel")?.value;
      if (expression.tag === "a" && target === "_blank" && (typeof relation !== "string" || !relation.split(/\s+/u).includes("noopener"))) {
        this.diagnostics.push(diagnostic("VEL5028", "An anchor with target='_blank' requires rel='noopener'", expression.span));
      }
      if (expression.tag === "iframe" && attributes.has("srcdoc")) this.reportIframeSrcdocSandbox(expression, attributes);
    }
    if (component) this.analyzeComponentElement(expression);
    const key = expression.attributes.find((attribute) => attribute.name === "key");
    if (key) this.staticJsxKeys.push({ element: expression, attribute: key });
    for (const child of expression.children) {
      if (child.kind === "JSXExpressionChild") {
        // The keyed recognizer is purely syntactic, so the honored roots of this
        // interpolation are known before its expression is inferred; a nested
        // element then knows whether its own key is honored (WEB-C1).
        this.checkKeyedInterpolation(child.expression);
        const childType = this.inferExpression(child.expression);
        if (containsPromise(this.expandAliases(childType))) this.diagnostics.push(diagnostic("VEL5031", "JSX cannot render a Promise; await it before rendering", child.expression.span));
        else if (!isInvalidType(childType) && !(child.expression.kind === "ListExpression" && child.expression.elements.length === 0)
          && !this.isJsxRenderable(childType)) {
          this.diagnostics.push(diagnostic("VEL5047", `JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values; received ${describeType(childType)}`, child.expression.span));
        } else if (this.isScalarTextType(childType)) {
          // F1: the checked type is the only place this is knowable. A span
          // already claimed by another extension hint keeps it — the fast path
          // is an optimisation and yields, where a look's arithmetic lowering
          // would not.
          const identity = spanIdentity(child.expression.span);
          if (!this.extensionCalls.has(identity)) this.extensionCalls.set(identity, JSX_SCALAR_TEXT_HINT);
        }
      } else if (child.kind === "ExtensionExpression:web:jsx") {
        this.inferJsx(child);
      }
    }
    this.jsxDepth -= 1;
    return webNodeType;
  }

  /**
   * WEB-S3: `srcdoc` builds a whole document out of a string, and that document
   * inherits this page's origin — so it is a second raw-HTML boundary next to
   * the one the charter names (`unsafe:html`), reachable with no marker at all.
   * The marker this one gets is `sandbox`, because sandbox is what actually
   * takes the origin away; requiring it makes the boundary visible where it is
   * crossed. `allow-scripts allow-same-origin` together hands the origin back,
   * so the pair is refused by name rather than accepted as a sandbox.
   */
  private reportIframeSrcdocSandbox(expression: JSXElementExpression, attributes: ReadonlyMap<string, JSXAttribute>): void {
    const sandbox = attributes.get("sandbox");
    if (!sandbox) {
      this.diagnostics.push(diagnostic(
        "VEL5066",
        "An iframe with srcdoc builds a document from a string, and that document runs script in this page's origin; add a sandbox attribute such as sandbox=\"allow-forms\" — write sandbox=\"\" when the frame needs no capability at all",
        expression.span,
      ));
      return;
    }
    const tokens = typeof sandbox.value === "string" ? sandbox.value
      : sandbox.value && sandbox.value.kind === "LiteralExpression" && typeof sandbox.value.value === "string" ? sandbox.value.value
        : null;
    if (tokens === null) return;
    const granted = new Set(tokens.split(/\s+/u).filter(Boolean));
    if (granted.has("allow-scripts") && granted.has("allow-same-origin")) {
      this.diagnostics.push(diagnostic(
        "VEL5066",
        "sandbox='allow-scripts allow-same-origin' lets the framed document remove its own sandbox, so a srcdoc frame with both is not sandboxed at all; drop one of the two",
        sandbox.span,
      ));
    }
  }

  /**
   * WEB-S2: the analyzer already refuses an anchor that opens a window without
   * 'noopener', so a URL attribute whose value is a script scheme cannot be the
   * one URL question it declines to ask. A written-down URL is answered here; a
   * value that arrives at run time is answered by the runtime attribute check.
   */
  private reportUrlAttributeScheme(attribute: JSXAttribute): void {
    if (!WEB_URL_ATTRIBUTES.has(attribute.name)) return;
    const value = attribute.value;
    const written = typeof value === "string" ? [value] : value ? literalStringValues(value) : null;
    if (written === null) return;
    for (const text of written) {
      const refusal = urlSchemeRefusal(text);
      if (!refusal) continue;
      this.diagnostics.push(diagnostic("VEL5067", `JSX '${attribute.name}' takes a URL, and ${refusal}`, attribute.span));
      return;
    }
  }

  // Mirrors the emitter's keyed-children recognizer (dynamicChildLeaves): a
  // leaf shaped `source.map(item => <… key=… />)` — either the interpolation
  // itself or a '?:' branch of it — compiles to the identity-preserving keyed
  // path. A map leaf without a key must gain one (VEL5017), and a key that
  // sits anywhere else in the interpolation would be silently ignored at
  // runtime, so it is diagnosed instead of quietly rebuilding every child.
  private checkKeyedInterpolation(expression: Expression): void {
    const honoredKeyRoots = new Set<JSXElementExpression>();
    for (const leaf of dynamicChildLeaves(expression)) {
      if (!leaf.list) continue;
      if (leaf.list.key) {
        honoredKeyRoots.add(leaf.list.arrow.body);
        // D89 A4: the list this keyed position renders by identity. A rewrite
        // of that same list is what changes every row's identity at once.
        const source = leaf.list.source.kind === "IdentifierExpression" ? this.lookup(leaf.list.source.name) : null;
        if (source) this.keyedListSources.add(spanIdentity(source.span));
      } else this.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", leaf.list.arrow.body.span));
    }
    for (const root of honoredKeyRoots) this.honoredJsxKeys.add(root);
    this.reportIneffectiveJsxKeys(expression, honoredKeyRoots);
  }

  // Walks one interpolation expression looking for `key` attributes that the
  // keyed fast path will never read. The walk stops at every JSX element:
  // an element's own children and attribute values are separate render sites
  // that receive their own checks when analysis recurses into them.
  private reportIneffectiveJsxKeys(value: unknown, honored: ReadonlySet<JSXElementExpression>): void {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "ExtensionExpression:web:jsx") {
      const element = record as unknown as JSXElementExpression;
      if (honored.has(element)) return;
      const key = element.attributes.find((attribute) => attribute.name === "key");
      if (key) {
        this.reportedJsxKeys.add(element);
        this.diagnostics.push(diagnostic(
          "VEL5050",
          "This JSX key has no effect: keys reuse children by identity only when the interpolation is 'items.map(item => <Row key={item.id} />)' or a '?:' branch of one; every other shape rebuilds its children on change — restructure the interpolation into that shape or remove the key",
          key.span,
        ));
      }
      return;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach((item) => this.reportIneffectiveJsxKeys(item, honored));
      else this.reportIneffectiveJsxKeys(child, honored);
    }
  }

  private analyzeComponentElement(expression: JSXElementExpression): void {
    const component = this.inferExpression({ kind: "IdentifierExpression", name: expression.tag, span: expression.tagSpan });
    if (!isWebComponentType(component)) {
      this.diagnostics.push(diagnostic("VEL5011", `Unknown component '${expression.tag}'`, expression.span));
      return;
    }
    const provided = new Set(expression.attributes.filter((attribute) => attribute.name !== "key" && attribute.name !== "ref" && !removedJsxControlAttributes.has(attribute.name)).map((attribute) => attribute.name));
    const hasChildren = expression.children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
    if (hasChildren && provided.has("children")) this.diagnostics.push(diagnostic("VEL5014", `Component '${expression.tag}' receives children both as a prop and as JSX content`, expression.span));
    // D31 item 26: the message used to state the deficiency and stop. `children`
    // is an ordinary named prop, so the remedy is one declaration and the
    // diagnostic is the only place the charter's reader meets its spelling.
    else if (hasChildren && !component.properties.has("children")) this.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children; declare a 'children: WebNode' prop to accept them`, expression.span));
    else if (hasChildren) {
      provided.add("children");
      this.requireAssignable(webNodeType, component.properties.get("children")!, expression.span);
    }
    for (const required of component.requiredProperties) {
      if (provided.has(required)) continue;
      // D31-26 promised that `children: WebNode?` is the omittable form; the
      // implementation makes a prop omittable through its default value, so the
      // diagnostic teaches the spelling that actually omits (WEB-N4).
      const declared = component.properties.get(required);
      const optionalDeclaration = declared !== undefined && this.expandAliases(declared).kind === "optional";
      this.diagnostics.push(diagnostic("VEL5012", optionalDeclaration
        ? `Component '${expression.tag}' requires prop '${required}'; a prop becomes omittable through its default value — declare '${required}: ${describeType(declared)} = null' on the component`
        : `Component '${expression.tag}' requires prop '${required}'`, expression.span));
    }
    for (const attribute of expression.attributes) {
      if (removedJsxControlAttributes.has(attribute.name)) continue;
      if (attribute.name === "key") {
        const key = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (!isInvalidType(key) && key.kind !== "string" && key.kind !== "number" && key.kind !== "enum" && key.kind !== "enumMember" && key.kind !== "any") this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
        continue;
      }
      if (attribute.name === "ref") {
        this.analyzeComponentRef(expression, attribute, component);
        continue;
      }
      const expected = component.properties.get(attribute.name);
      if (attribute.name === "look") {
        this.analyzeJsxLookAttribute(attribute);
        continue;
      }
      if (attribute.name.startsWith("look:")) {
        const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        this.analyzeInlineVisualAttribute(attribute, actual, "look");
        continue;
      }
      if (attribute.name === "style") {
        if (attribute.value && typeof attribute.value !== "string") this.inferExpression(attribute.value);
        this.diagnostics.push(diagnostic("VEL5041", "Raw JSX style is not supported; use style:property for a checked high-priority inline override, or prefer Look for ordinary visuals", attribute.span));
        continue;
      }
      if (attribute.name.startsWith("style:")) {
        const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        this.analyzeInlineVisualAttribute(attribute, actual, "style");
        continue;
      }
      if (attribute.name === "class") {
        const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (!this.isClassInput(actual)) this.diagnostics.push(diagnostic("VEL5040", `JSX class requires string, string?, or a list of strings; received ${describeType(actual)}`, attribute.span));
        continue;
      }
      if (!expected) {
        this.diagnostics.push(diagnostic("VEL5013", `Component '${expression.tag}' has no prop '${attribute.name}'`, attribute.span));
        continue;
      }
      this.semanticJsxAttributeOwners.set(`${attribute.span.start}:${attribute.name}`, component);
      // D51 rule 108: a JSX attribute is a typed position, exactly like an
      // argument position, so the declared prop type is the literal's context.
      // Without it `items={[]}` inferred List<unknown> and forced the author to
      // annotate an empty list on a separate line.
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value, expected) : boolType;
      if (isWebComponentConstructor(component) && webComponentIntrinsic(component) === "web.router" && attribute.name === "fallback" && actual.kind !== "null" && actual.kind !== "any") {
        this.checkWebRouteComponent(actual, attribute.span, "A Router fallback");
      }
      if (isWebComponentConstructor(component) && webComponentIntrinsic(component) === "web.router" && attribute.name === "routes"
        && attribute.value !== null && typeof attribute.value !== "string") {
        this.checkWebRouteRecords(attribute.value);
      }
      this.requireAssignable(actual, expected, attribute.span);
    }
  }

  /**
   * The `look=` attribute on either host kind. A Look block written inline is
   * reported without inferring its entries, so the one directive-level message
   * stands alone; an empty list names the accepted family rather than rendering
   * `List<unknown>` (LOK-I3, LOK-I6).
   */
  private analyzeJsxLookAttribute(attribute: JSXAttribute): void {
    const value = attribute.value;
    if (!value) {
      this.diagnostics.push(diagnostic("VEL5040", "JSX look requires an expression value", attribute.span));
      return;
    }
    if (typeof value === "string") {
      this.diagnostics.push(diagnostic("VEL5040", "JSX look requires an expression value such as look={cardLook}", attribute.span));
      return;
    }
    if (value.kind === "ExtensionExpression:web:look") {
      this.diagnostics.push(diagnostic("VEL5053", "An inline Look block is not supported; use look:property directives for simple overrides or extract a const Look for conditions and targets", attribute.span));
      return;
    }
    if (value.kind === "ListExpression" && value.elements.length === 0) {
      this.diagnostics.push(diagnostic("VEL5040", "JSX look accepts a Look, a Look?, or a list of Look values; an empty list composes nothing — remove the attribute", attribute.span));
      return;
    }
    const actual = this.inferExpression(value);
    if (!this.isLookInput(actual)) this.diagnostics.push(diagnostic("VEL5040", `JSX look requires Look, Look?, or a list of Look values; received ${describeType(actual)}`, attribute.span));
    if (value.kind === "ListExpression") this.reportIndependentLookCollisions(value, attribute);
  }

  /**
   * Composition is how a Look overrides another one: `...baseLook` puts the two
   * in an order the reader can see, and everything after it wins. Two looks
   * placed side by side on one element state no order at all, so a property both
   * of them set has no answer the source gives — the winner used to fall out of
   * whichever rule the stylesheet happened to carry last. The shape is refused
   * rather than ordered by fiat, and the refusal names the spelling that states
   * the order the author meant.
   */
  private reportIndependentLookCollisions(value: Extract<Expression, { kind: "ListExpression" }>, attribute: JSXAttribute): void {
    const entries: { readonly name: string; readonly look: WebLookExpression }[] = [];
    for (const element of value.elements) {
      if (element.kind !== "IdentifierExpression") continue;
      const look = this.lookDeclarations.get(element.name);
      if (look) entries.push({ name: element.name, look });
    }
    for (const [index, first] of entries.entries()) {
      for (const second of entries.slice(index + 1)) {
        if (first.name === second.name) continue;
        const left = lookContributions(first.look, this.lookDeclarations);
        const right = lookContributions(second.look, this.lookDeclarations);
        // A look that composes the other is already ordered against it: the
        // spread says which one is the base, so nothing here is ambiguous.
        if (left.composed.has(second.name) || right.composed.has(first.name)) continue;
        const collision = [...left.properties].find((property) => right.properties.has(property));
        if (collision === undefined) continue;
        const property = collision.slice(collision.indexOf(":") + 1);
        const target = collision.slice(0, collision.indexOf(":"));
        this.diagnostics.push(diagnostic(
          "VEL5068",
          `Look '${first.name}' and Look '${second.name}' both set '${property}'${target ? ` on '@${target}'` : ""}, and placing them side by side states no order between them; write one Look that starts with '...${first.name}' and overrides '${property}' from there, then pass that one`,
          attribute.span,
        ));
        return;
      }
    }
  }

  private analyzeComponentRef(
    expression: JSXElementExpression,
    attribute: JSXAttribute,
    component: WebComponentType,
  ): void {
    const value = attribute.value;
    if (!value || typeof value === "string" || value.kind !== "IdentifierExpression"
      || !this.lookup(value.name)?.mutable || this.writableStateName(value.name)) {
      this.diagnostics.push(diagnostic("VEL5057", "A component ref requires a mutable let binding", attribute.span));
      return;
    }
    const handle = webComponentHandle(component);
    if (!handle) {
      this.diagnostics.push(diagnostic("VEL5057", `Component '${expression.tag}' does not expose a Handle`, attribute.span));
      return;
    }
    const bindingType = this.lookup(value.name)!.type;
    if (bindingType.kind !== "any" && bindingType.kind !== "optional") {
      this.diagnostics.push(diagnostic("VEL5057", `A component ref requires ${describeType(handle)}? so cleanup can restore null`, attribute.span));
      return;
    }
    const target = nonOptional(bindingType);
    if (target.kind !== "any" && !isAssignable(handle, target, this)) {
      this.diagnostics.push(diagnostic("VEL5057", `Component '${expression.tag}' exposes ${describeType(handle)}, but this ref stores ${describeType(target)}?`, attribute.span));
    }
  }

  private analyzeNativeJsxAttribute(expression: JSXElementExpression, attribute: JSXAttribute): void {
    const value = attribute.value;
    this.reportUrlAttributeScheme(attribute);
    const eventName = attribute.name.startsWith("on:") ? attribute.name.slice(3).split(".")[0] ?? "" : "";
    const expectedEvent = eventName ? webEventType(eventName) : null;
    // GRM-A4: the declared handler type returns null. `() => {}` after a fat
    // arrow is an empty-record factory rather than an empty block, so a handler
    // position that accepted any result silently accepted that record.
    const eventHandlerType: ValueType | null = expectedEvent ? { kind: "function", parameters: [expectedEvent], requiredParameters: 1, result: nullType } : null;
    // An event arrow that assigns a state binding from an event field is the
    // hand-rolled spelling of a two-way binding: it receives bind:value
    // guidance and skips ordinary handler inference so the guidance is not
    // buried under a cascade from the recovered assignment.
    const boundState = (eventName || /^on[A-Z]/u.test(attribute.name)) ? this.eventAssignedStateBinding(value) : null;
    if (boundState) {
      this.diagnostics.push(diagnostic(
        "VEL5019",
        `Use 'bind:value={${boundState}}'; VelarScript binds input state with the bind: directive instead of assigning state from event fields`,
        attribute.span,
      ));
    }
    // A `look=` value is inferred inside its own check so an inline Look block
    // is reported once rather than analyzed as a snapshot as well.
    const inferred = typeof value === "string" ? stringType
      : boundState || attribute.name === "look" ? anyType
        : value ? this.inferExpression(value, eventHandlerType ?? unknownType) : boolType;
    if (attribute.name === "style") {
      this.diagnostics.push(diagnostic("VEL5041", "Raw JSX style is not supported; use style:property for a checked high-priority inline override, or prefer Look for ordinary visuals", attribute.span));
    } else if (attribute.name.startsWith("style:")) {
      this.analyzeInlineVisualAttribute(attribute, inferred, "style");
    } else if (attribute.name === "look") {
      this.analyzeJsxLookAttribute(attribute);
    } else if (attribute.name.startsWith("look:")) {
      this.analyzeInlineVisualAttribute(attribute, inferred, "look");
    } else if (attribute.name === "class") {
      if (!this.isClassInput(inferred)) this.diagnostics.push(diagnostic("VEL5040", `JSX class requires string, string?, or a list of strings; received ${describeType(inferred)}`, attribute.span));
    } else if (attribute.name === "unsafe:html") {
      if (!isInvalidType(inferred) && inferred.kind !== "any" && !this.isOptionalString(inferred)) {
        this.diagnostics.push(diagnostic("VEL5047", `unsafe:html requires string or string?, received ${describeType(inferred)}`, attribute.span));
      }
    // D90 coherence-3, one step sideways: `unsafe:` is a closed prefix with
    // exactly one member, so `unsafe:script=` is wrong by construction rather
    // than merely unrecognised — and it used to be emitted verbatim as a dead
    // attribute, which is the worst possible answer for a name that reads like
    // an escape hatch the author believes they opened.
    } else if (attribute.name.startsWith("unsafe:")) {
      this.diagnostics.push(diagnostic("VEL5015", `Unknown escape hatch '${attribute.name}'; 'unsafe:html' is the only one an element has, and it takes the HTML text as a string`, attribute.span));
    } else if (attribute.name === "bind:value") {
      if (!this.isWritableBindTarget(value)) {
        this.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:value"), attribute.span));
      } else {
        if (!["input", "textarea", "select"].includes(expression.tag)) this.diagnostics.push(diagnostic("VEL5019", `bind:value is not valid on <${expression.tag}>`, attribute.span));
        const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
        this.requireAssignable(inferred, numeric ? numberType : stringType, attribute.span);
        if (!numeric && inferred.kind === "enum") this.enumValueBindings.set(attribute.span.start, inferred.name);
      }
    } else if (attribute.name === "bind:checked") {
      if (!this.isWritableBindTarget(value)) {
        this.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:checked"), attribute.span));
      } else {
        if (expression.tag !== "input") this.diagnostics.push(diagnostic("VEL5019", `bind:checked is not valid on <${expression.tag}>`, attribute.span));
        this.requireAssignable(inferred, boolType, attribute.span);
      }
    } else if (attribute.name === "bind:group") {
      this.analyzeBindGroup(expression, attribute, value, inferred);
    } else if (attribute.name === "ref") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || !this.lookup(value.name)?.mutable) {
        this.diagnostics.push(diagnostic("VEL5020", "ref requires a mutable let binding", attribute.span));
      } else {
        const bindingType = this.lookup(value.name)!.type;
        const target = nonOptional(bindingType);
        const expected = expression.tag === "canvas" ? "CanvasElement" : expression.tag === "dialog" ? "DialogElement" : expression.tag === "textarea" ? "TextAreaElement" : ["input", "select"].includes(expression.tag) ? "InputElement" : "Element";
        const accepted = expected === "TextAreaElement" ? new Set(["TextAreaElement", "InputElement", "Element"]) : new Set([expected, "Element"]);
        if (bindingType.kind !== "any" && bindingType.kind !== "optional") this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or a parent element type so cleanup can restore null`, attribute.span));
        else if (target.kind !== "any" && (target.kind !== "named" || !accepted.has(target.name))) this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or a parent element type`, attribute.span));
      }
    // The three branches above are the whole `bind:` family, so a fourth suffix
    // names no binding — and it used to reach the attribute emitter and render
    // a dead `bind:foo` attribute, silently binding nothing. Same shape as the
    // React-spelling rule: a closed VelarScript vocabulary, so an outside name
    // is wrong rather than unknown.
    } else if (attribute.name === "bind" || attribute.name.startsWith("bind:")) {
      const property = attribute.name.slice("bind:".length);
      const nearest = property ? nearestLookName(property, ["value", "checked", "group"]) : null;
      this.diagnostics.push(diagnostic("VEL5019", property
        ? `Unknown binding 'bind:${property}'${nearest ? `; did you mean 'bind:${nearest}'?` : "; an element binds bind:value for a field, bind:checked for a flag, and bind:group for a set of choices"}`
        : "Use 'bind:value={name}'; the bind directive names the bound property, such as bind:value or bind:checked", attribute.span));
    // WEB-S1: the guard used to be anchored on an uppercase letter, which
    // closed the React reflex `onClick=` and left the lowercase HTML spelling
    // open. Both are the same attribute — an HTML attribute name is matched
    // ASCII-case-insensitively, and `setAttribute` lowercases on an HTML
    // element, so `onClick` and `ONCLICK` reach `onclick` too. That attribute
    // is the one that matters: the browser compiles its value as script, so any
    // string routed there is executable code in the application's origin, which
    // the charter reserves for `unsafe:html`. So a native element reserves the
    // whole `on` prefix by name rather than by a roster of handler names: a
    // roster leaves the next handler spelling open, and every event is written
    // with the `on:` directive anyway. The lookahead keeps that directive out.
    } else if (/^on(?!:)/iu.test(attribute.name)) {
      const camel = attribute.name.slice(2);
      const event = camel === "DoubleClick" || camel === "DblClick" ? "dblclick" : camel.toLowerCase();
      // Only a name the browser really compiles as script earns the executable
      // clause; a name that is no event at all is refused by the prefix rule,
      // not by the browser, and a message that claimed otherwise would state a
      // rule the author did not hit. The roster answering that question is
      // HTML's handler attributes, read case-insensitively as the browser reads
      // them — the `on:` directive vocabulary is a different question and
      // answered it wrongly in both directions.
      const executable = htmlEventHandlerAttributes.has(attribute.name.toLowerCase());
      // A concrete `on:` replacement is worth naming only when the remainder is
      // a real event; `onward` would otherwise be answered with `on:ward`.
      const named = executable || nativeDomEventNames.has(event);
      const script = executable
        ? ` — an '${attribute.name}' attribute is compiled as script by the browser, so any value written there runs`
        : "";
      if (attribute.name === "onEnter") {
        this.diagnostics.push(diagnostic("VEL5025", "Use 'on:keydown' with a handler that checks 'event.key == \"Enter\"'; VelarScript has no dedicated enter-key event", attribute.span));
      } else {
        this.diagnostics.push(diagnostic("VEL5025", named
          ? `Use 'on:${event}'; VelarScript event attributes use the on: directive, written 'on:${event}={handler}'${script}`
          : "Use an 'on:event' directive with a native DOM event name, such as 'on:click={handler}' or 'on:keydown={handler}'; an element reserves every attribute name beginning with 'on' other than the 'on:' directive itself, because the handler spellings among them — 'onclick', 'onerror', 'onload' — are executable script in the browser", attribute.span));
      }
    } else if (attribute.name.startsWith("on:")) {
      const [event, ...modifiers] = attribute.name.slice(3).split(".");
      const supported = new Set(["prevent", "stop", "once", "capture", "self"]);
      if (!event) this.diagnostics.push(diagnostic("VEL5025", "An event directive requires an event name", attribute.span));
      for (const modifier of modifiers) if (!supported.has(modifier)) this.diagnostics.push(diagnostic("VEL5025", `Unknown event modifier '${modifier}'`, attribute.span));
      if (new Set(modifiers).size !== modifiers.length) this.diagnostics.push(diagnostic("VEL5025", "Event modifiers cannot be repeated", attribute.span));
      if (!isInvalidType(inferred) && inferred.kind !== "function" && inferred.kind !== "action" && inferred.kind !== "intrinsic" && inferred.kind !== "any") {
        this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' requires a function`, attribute.span));
      } else if (inferred.kind === "function" || inferred.kind === "action" || inferred.kind === "intrinsic") {
        if (inferred.rest || inferred.parameters.length > 1) this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' handlers accept zero parameters or one ${describeType(expectedEvent ?? { kind: "named", name: "Event" })} parameter`, attribute.span));
        else if (inferred.parameters.length === 1 && expectedEvent && !isAssignable(expectedEvent, inferred.parameters[0]!, this)) this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' provides ${describeType(expectedEvent)}, not ${describeType(inferred.parameters[0]!)}`, attribute.span));
        this.checkEventHandlerResult(event ?? "", value, inferred.result, attribute.span);
      }
    } else if (attribute.name.startsWith("class:")) {
      this.requireAssignable(inferred, boolType, attribute.span);
    } else if (attribute.name === "key" && !isInvalidType(inferred) && inferred.kind !== "string" && inferred.kind !== "number" && inferred.kind !== "enum" && inferred.kind !== "enumMember" && inferred.kind !== "any") {
      this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
    // The name check sits at the tail of the chain so every directive above it
    // — look:, class:, on:, bind:, ref, key — keeps owning its own spelling and
    // is never read as an HTML attribute name. It reports at most once per
    // attribute and short-circuits the value-shape message, so a React spelling
    // is answered with its successor rather than with two half-answers.
    } else if (!this.reportNativeAttributeSpelling(expression, attribute)
      && !isInvalidType(inferred) && !this.isJsxAttributeValue(inferred)) {
      this.diagnostics.push(diagnostic("VEL5047", `Native JSX attributes require text, finite numbers, bool, enums, or null; received ${describeType(inferred)}`, attribute.span));
    }
    if (!isInvalidType(inferred)) this.adviseNativeBooleanTextConversion(expression.tag, attribute);
    if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
      && !expression.attributes.some((item) => item.name === "role")) this.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
  }

  /**
   * A14: `condition ? "true" : "false"` is the expanded spelling of the Core
   * text conversion `str(condition)`. Keep that conversion explicit at a DOM
   * text boundary instead of teaching every attribute its own coercion rule.
   *
   * The rule does not reach component props or HTML bool-presence attributes.
   * A string "false" keeps such an attribute present; accepting that spelling
   * as canonical would hide a likely presence bug whose direct expression is
   * the bool itself.
   */
  private adviseNativeBooleanTextConversion(tag: string, attribute: JSXAttribute): void {
    if (!WEB_NATIVE_ELEMENTS.has(tag)) return;
    const value = attribute.value;
    if (!value || typeof value === "string" || !this.plainNativeTextAttribute(tag, attribute.name)) return;
    const written = this.webSourceText.slice(value.span.start, value.span.end);
    if (written.length === 0) return;

    if (value.kind === "ConditionalExpression"
      && value.thenValue.kind === "LiteralExpression" && value.thenValue.value === "true"
      && value.elseValue.kind === "LiteralExpression" && value.elseValue.value === "false") {
      if (this.expandAliases(this.inferredExpressionType(value.condition)).kind !== "bool") return;
      const replacement = this.webSourceText.slice(value.condition.span.start, value.condition.span.end);
      if (!replacement) return;
      // The condition is copied verbatim into str(...), so comments inside it
      // survive. Only comments in discarded punctuation/branches make the
      // mechanical rewrite unsafe.
      const omitted = `${this.webSourceText.slice(value.span.start, value.condition.span.start)}${this.webSourceText.slice(value.condition.span.end, value.span.end)}`;
      this.advise(
        "A14",
        `Native attribute '${attribute.name}' spells this bool as text; write the equivalent str(condition) conversion directly`,
        value.span,
        omitted.includes("//") || omitted.includes("/*")
          ? undefined
          : mechanicalFix(value.span, `str(${replacement})`, `Convert the bool with str() for '${attribute.name}'`),
      );
    }
  }

  /** Directives and compiler-owned control attributes do not use DOM text conversion. */
  private plainNativeTextAttribute(tag: string, name: string): boolean {
    if (WEB_MISSPELLED_ATTRIBUTES.has(name) || /^aria[A-Z]/u.test(name)) return false;
    if (name.startsWith("aria-") && !WEB_ARIA_ATTRIBUTES.has(name)) return false;
    if (WEB_HTML_ELEMENTS.has(tag) && WEB_BOOL_PRESENCE_HTML_ATTRIBUTES.has(name.toLowerCase())) return false;
    return name !== "class" && name !== "host" && name !== "key" && name !== "look" && name !== "ref"
      && name !== "style" && !/^(?:bind|class|look|on|style|unsafe):/u.test(name) && !/^on/iu.test(name);
  }

  /**
   * D90 coherence-3: DOM attribute names and ARIA are documented as checked
   * surfaces, and nothing checked them — `className="panel"` compiled clean and
   * emitted a dead attribute, while the sibling React reflex `onClick=` on the
   * same element was already refused. So a model got a clean bill of health on
   * exactly the half of its React habit that silently breaks the page.
   *
   * The rule diagnoses names that are KNOWN wrong, never names that are merely
   * unknown. HTML lets a document carry attributes no roster can enumerate, so
   * `foo="bar"`, `data-*`, and a framework's own prefixes stay legal; a false
   * positive there would block a correct program, which is worse than the
   * silence it replaces. Three closed rosters answer three closed questions:
   * the React / JavaScript-property spellings, the ARIA attribute names (ARIA,
   * unlike HTML, admits no custom names), and the ARIA and role vocabularies.
   *
   * D61 bounds the value half. Every native attribute uses the same presence
   * rule: false/null remove it, true writes an empty value, and strings carry
   * literal text. A token vocabulary is therefore read only against a string
   * literal; expression values are runtime questions. A14 separately shortens
   * an explicit bool-to-text conditional to `str(bool)` when that rewrite is
   * provably equivalent.
   *
   * Returns true when it reported, so the caller does not stack a value-shape
   * message on an attribute whose name is already answered.
   */
  private reportNativeAttributeSpelling(expression: JSXElementExpression, attribute: JSXAttribute): boolean {
    // A custom element owns its own attribute vocabulary, and an unknown tag was
    // already reported as a tag; neither is a surface these rosters describe.
    if (!WEB_NATIVE_ELEMENTS.has(expression.tag)) return false;
    const name = attribute.name;
    // The attribute span opens on the name, so the name occupies its first
    // `name.length` characters — the range a rename rewrites, leaving the value
    // exactly as written.
    const nameSpan: Span = { start: attribute.span.start, end: attribute.span.start + name.length };
    const rename = (write: string) => ({ fix: { title: `Use '${write}'`, edits: [{ span: nameSpan, text: write }] } });
    const spelling = WEB_MISSPELLED_ATTRIBUTES.get(name);
    if (spelling) {
      this.diagnostics.push({
        code: "VEL5070",
        message: `'${name}' is not a native attribute name; write '${spelling.write}'${spelling.note ? ` ${spelling.note}` : ""}`,
        span: attribute.span,
        ...(spelling.note === undefined ? rename(spelling.write) : {}),
      });
      return true;
    }
    if (/^aria[A-Z]/u.test(name)) {
      // Every ARIA attribute is `aria-` followed by one lowercase word, so
      // lowercasing the remainder recovers the spelling whenever one exists.
      const hyphenated = `aria-${name.slice(4).toLowerCase()}`;
      const known = WEB_ARIA_ATTRIBUTES.has(hyphenated);
      this.diagnostics.push({
        code: "VEL5070",
        message: known
          ? `'${name}' is not a native attribute name; ARIA attribute names are hyphenated — write '${hyphenated}'`
          : `'${name}' is not a native attribute name; ARIA attribute names are hyphenated and lowercase, such as 'aria-label'`,
        span: attribute.span,
        ...(known ? rename(hyphenated) : {}),
      });
      return true;
    }
    if (name.startsWith("aria-") && !WEB_ARIA_ATTRIBUTES.has(name)) {
      const nearest = nearestLookName(name, WEB_ARIA_ATTRIBUTES);
      this.diagnostics.push({
        code: "VEL5070",
        message: nearest
          ? `Unknown ARIA attribute '${name}'; did you mean '${nearest}'?`
          : `Unknown ARIA attribute '${name}'; ARIA defines a closed set of aria-* names, so a state or property it does not define belongs on a data-* attribute`,
        span: attribute.span,
        ...(nearest ? rename(nearest) : {}),
      });
      return true;
    }
    // Only a literal value is read. A fix is not registered for a value: the
    // attribute span opens on the name, so the value's own range is not known
    // here, and the message names the token instead.
    const literal = attribute.value;
    // The empty string is not an out-of-vocabulary token: ARIA reads it as the
    // attribute's own default, so `aria-hidden=""` is an uncommon but correct
    // spelling of "not hidden" and refusing it would block a working document.
    // `role=""` is already silent for the same reason — its loop skips empty
    // tokens — so this keeps the two halves of the value check agreeing.
    if (typeof literal !== "string" || literal === "") return false;
    const vocabulary = WEB_ARIA_ENUMERATED_VALUES.get(name);
    if (vocabulary && !vocabulary.has(literal)) {
      const nearest = nearestLookName(literal, vocabulary);
      this.diagnostics.push(diagnostic("VEL5070",
        `'${name}' takes one of ${[...vocabulary].join(", ")}; '${literal}' is not one of them${nearest ? ` — did you mean '${nearest}'?` : ""}`,
        attribute.span));
      return true;
    }
    if (name === "role") {
      // `role` takes a space-separated fallback list, so each token is its own
      // question and only the unknown ones are named.
      let reported = false;
      for (const token of literal.split(/\s+/u)) {
        if (!token || WEB_ARIA_ROLES.has(token)) continue;
        // A published second spelling is answered as a synonym rather than as
        // an unknown name. `image` is ARIA's own later spelling of `img`, and
        // "Unknown ARIA role 'image'" would assert something false about it.
        const synonym = WEB_ARIA_ROLE_SYNONYMS.get(token);
        const nearest = synonym ? null : nearestLookName(token, WEB_ARIA_ROLES);
        this.diagnostics.push(diagnostic("VEL5070", synonym
          ? `ARIA publishes '${token}' and '${synonym}' as one role; VelarScript writes '${synonym}'`
          : nearest
            ? `Unknown ARIA role '${token}'; did you mean '${nearest}'?`
            : `Unknown ARIA role '${token}'; role takes an ARIA role name such as 'button', 'dialog', or 'status'`, attribute.span));
        reported = true;
      }
      return reported;
    }
    return false;
  }

  /**
   * GRM-A4: an event handler runs for effect and returns null. The hole this
   * closes is `on:click={() => {}}`: after a fat arrow, braces build a record,
   * never a block, so the empty-record factory used to be accepted as a handler
   * and silently did nothing on every click.
   */
  private checkEventHandlerResult(event: string, value: JSXAttribute["value"], result: ValueType, attributeSpan: Span): void {
    const resolved = this.expandAliases(result);
    // An asynchronous handler stays legal whatever it resolves to: attaching an
    // action directly or through a wrapper is a decided spelling, and an action
    // already owns its pending state, its errors, and its result.
    if (resolved.kind === "promise") return;
    if (resolved.kind === "null" || resolved.kind === "any" || isInvalidType(resolved) || resolved.kind === "unknown") return;
    const emptyRecordBody = value && typeof value !== "string" && value.kind === "ArrowFunctionExpression"
      && value.body.kind === "ObjectExpression" && value.body.properties.length === 0;
    this.diagnostics.push(diagnostic("VEL5021", emptyRecordBody
      ? `Event '${event}' handlers return null, and '{}' after '=>' builds an empty record rather than an empty block; write '() => null' for a handler that does nothing, or name a 'def' that performs the work`
      : `Event '${event}' handlers return null; this handler returns ${describeType(result)} — the result is discarded, so call it inside a 'def' that returns null`, attributeSpan));
  }

  /**
   * D47 rule 84(A): a bind target is a writable reactive location — a state
   * name, or a record-field / List-index / Map-key path rooted in one. A
   * computed accessor, a const, and a function result stay rejected: nothing
   * would receive the write.
   */
  private isWritableBindTarget(value: JSXAttribute["value"]): boolean {
    if (!value || typeof value === "string") return false;
    if (value.kind === "IdentifierExpression") return this.writableStateName(value.name);
    return this.bindPathRoot(value) !== null;
  }

  /**
   * Walks a member/index path inward to its root state binding, checking every
   * segment is a writable location: a declared record field, a List element, or
   * a Map value. Returns the root state name, or null when the path is not a
   * writable reactive location.
   */
  private bindPathRoot(value: Expression): string | null {
    const segments: Expression[] = [];
    let node: Expression = value;
    while (node.kind === "MemberExpression" || node.kind === "IndexExpression") {
      if (node.kind === "MemberExpression" && node.optional) return null;
      segments.push(node);
      node = node.object;
    }
    if (node.kind !== "IdentifierExpression" || !this.writableStateName(node.name)) return null;
    let current = this.expandAliases(this.lookup(node.name)!.type);
    for (const segment of segments.reverse()) {
      if (segment.kind === "MemberExpression") {
        const fields = current.kind === "object" ? current.fields
          : current.kind === "named" ? this.fieldsOf(current.identity ?? current.name) : null;
        const field = fields?.get(segment.property);
        if (!field) return null;
        current = this.expandAliases(field);
      } else if (current.kind === "list") current = this.expandAliases(current.element);
      else if (current.kind === "map" || current.kind === "record") current = this.expandAliases(current.value);
      else return null;
    }
    return node.name;
  }

  /**
   * D47 rule 84: `bind:group` binds a set of inputs that share one decision.
   * A radio group holds the selected input's `value`; a checkbox group holds the
   * checked values as a List<string>, so checking and unchecking are membership
   * changes.
   */
  private analyzeBindGroup(expression: JSXElementExpression, attribute: JSXAttribute, value: JSXAttribute["value"], inferred: ValueType): void {
    const inputType = expression.attributes.find((item) => item.name === "type")?.value;
    const kind = expression.tag === "input" && typeof inputType === "string" && (inputType === "radio" || inputType === "checkbox") ? inputType : null;
    if (!kind) {
      this.diagnostics.push(diagnostic("VEL5019", `bind:group binds a group of choices and requires <input type="radio"> or <input type="checkbox">; use bind:value for a single field and bind:checked for a single flag`, attribute.span));
      return;
    }
    if (!expression.attributes.some((item) => item.name === "value")) {
      this.diagnostics.push(diagnostic("VEL5019", `bind:group identifies each choice by its value attribute; add value="..." to this <input type="${kind}">`, attribute.span));
      return;
    }
    if (!this.isWritableBindTarget(value)) {
      this.diagnostics.push(diagnostic("VEL5019", bindTargetGuidance("bind:group"), attribute.span));
      return;
    }
    const expected: ValueType = kind === "radio" ? stringType : { kind: "list", element: stringType };
    if (kind === "radio" && inferred.kind === "enum") {
      this.enumValueBindings.set(attribute.span.start, inferred.name);
      return;
    }
    this.requireAssignable(inferred, expected, attribute.span);
  }

  // Matches 'event => stateName = event.field' (any member depth) where the
  // assignment target is a writable state binding, and returns that binding's
  // name; anything else returns null.
  private eventAssignedStateBinding(value: JSXAttribute["value"]): string | null {
    if (!value || typeof value === "string") return null;
    if (value.kind !== "ArrowFunctionExpression" || value.asynchronous || value.parameters.length !== 1) return null;
    const body = value.body;
    if (body.kind !== "AssignmentExpression" || body.target.kind !== "IdentifierExpression") return null;
    const state = body.target.name;
    if (!this.writableStateName(state)) return null;
    let source = body.value;
    while (source.kind === "MemberExpression") source = source.object;
    return source.kind === "IdentifierExpression" && source.name === value.parameters[0]!.name && body.value.kind === "MemberExpression"
      ? state
      : null;
  }

  private isLookInput(type: ValueType): boolean {
    if (type.kind === "any" || type.kind === "null") return true;
    if (type.kind === "named") return type.name === "Look";
    if (type.kind === "optional") return this.isLookInput(type.inner);
    if (type.kind === "list") return this.isLookInput(type.element);
    if (type.kind === "union") return type.members.every((member) => this.isLookInput(member));
    return false;
  }

  private isClassInput(type: ValueType): boolean {
    if (type.kind === "any" || type.kind === "null" || type.kind === "string") return true;
    if (type.kind === "optional") return this.isClassInput(type.inner);
    if (type.kind === "list") return this.isClassInput(type.element);
    if (type.kind === "union") return type.members.every((member) => this.isClassInput(member));
    return false;
  }

  private isJsxRenderable(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
      || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember" || isWebNodeType(expanded)) return true;
    if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
    if (expanded.kind === "optional") return this.isJsxRenderable(expanded.inner);
    if (expanded.kind === "list") return this.isJsxRenderable(expanded.element);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isJsxRenderable(member));
    return false;
  }

  /**
   * F1's qualifying rule, and the whole of it: the types whose rendering is
   * *exactly* one text node.
   *
   * `string` and `number` are the two. `__velarAppend` answers a string with one
   * text node carrying it — the empty string included, which is why `""` is not
   * a special case — and a number with one text node carrying `String(value)`,
   * or refuses a non-finite number. An enum member is text at runtime and is
   * assignable to `string`, so it rides the same branch it always did.
   *
   * Everything else stays on the full dynamic region, and the reason is always
   * the same one: it does not render as *one* node.
   * - `bool` renders **zero** nodes (`__velarAppend` returns on `true`/`false`),
   *   so a text node would be an added child where an element previously had
   *   none — observable to `:empty`, to `childNodes`, and to anything that
   *   walks them.
   * - An optional of either renders zero nodes when null and one when present,
   *   so it needs an anchor to come back to.
   * - `WebNode`, lists, unions, `any` and every named type can hold markup or
   *   several nodes, which is what the comment pair exists to bracket.
   *
   * Widening this set is a semantic ruling, not an optimisation: it would
   * change the node count of a rendered document.
   */
  private isScalarTextType(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    return expanded.kind === "string" || expanded.kind === "number";
  }

  private isJsxAttributeValue(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
      || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember") return true;
    if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
    if (expanded.kind === "optional") return this.isJsxAttributeValue(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isJsxAttributeValue(member));
    return false;
  }

  private isOptionalString(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "string" || expanded.kind === "null") return true;
    if (expanded.kind === "optional") return this.isOptionalString(expanded.inner);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isOptionalString(member));
    return false;
  }

  /**
   * The elements of a `<Router routes={...}>` list literal, one at a time.
   *
   * A route written as `route("/a", Panel)` is checked at that call; the record
   * that call returns — `{path: "/a", component: Panel}` — is a legal spelling
   * of the same value, reaches the same runtime position, and until now was
   * checked by nothing: `{path: "no-leading-slash", component: 5}` compiled
   * clean and handed `5` to the Router as a component. Closing the sink rather
   * than the spelling means asking the same questions wherever a route arrives,
   * so this reports exactly what `route(...)` reports, word for word.
   *
   * The runtime is already the second referee (D90 R19): `routerTable`
   * validates every path and refuses a component that is not callable. Nothing
   * here changes which programs run — it moves a refusal the author would have
   * met at mount to the place the source shows the mistake.
   *
   * The `any` component slot is skipped here rather than inside
   * `checkWebRouteComponent`, which is why that method carries no `any` arm:
   * this loop and the Router `fallback` attribute are its only two callers, and
   * both filter first. An `any` reaches this slot for real — `web.lazy` answers
   * `anyType` from each of its error paths — and it arrives with the author's
   * real message already reported, so a second "received any" would be a
   * cascade. The `route(...)` twin skips it for the same reason.
   */
  private checkWebRouteRecords(expression: Expression): void {
    if (expression.kind !== "ListExpression") return;
    for (const element of expression.elements) {
      if (element.kind !== "ObjectExpression") continue;
      for (const entry of element.properties) {
        if (entry.kind !== "ObjectProperty") continue;
        if (entry.name === "path") {
          const path = entry.value;
          if (path.kind === "LiteralExpression" && typeof path.value === "string") {
            checkRoutePath(path.value, path.span, (message, span) => this.typeError(message, span));
          }
          continue;
        }
        if (entry.name !== "component") continue;
        // The attribute has already been inferred as a whole, so every
        // sub-expression here has been reported once. This second pass exists
        // only to read the component slot's type back; anything it says is a
        // repeat of what the author already has, and is dropped. Advisories
        // need no such cursor — `advise` is deduplicated by code and span
        // precisely so a re-analysis cannot raise one twice.
        const reported = this.diagnostics.length;
        const type = this.inferExpression(entry.value);
        this.diagnostics.splice(reported);
        if (type.kind === "any") continue;
        this.checkWebRouteComponent(type, entry.value.span, "A route");
      }
    }
  }

  private checkWebRouteComponent(type: ValueType, sourceSpan: Span, subject: string): void {
    if (isInvalidType(type)) return;
    if (!isWebComponentType(type)) {
      // No `any` arm, unlike the `route(...)` twin above: both callers — the
      // Router `fallback` attribute and `checkWebRouteRecords` — already filter
      // `any` out before they call here, so a branch for it could never run.
      this.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
      return;
    }
    const unsupported = [...type.requiredProperties].filter((name) => name !== "route");
    if (unsupported.length > 0) this.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
    const routeProp = type.properties.get("route");
    if (routeProp && !isAssignable({ kind: "named", name: "RouteContext", identity: routeContextIdentity }, routeProp, this)) this.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
  }

  private analyzeInlineVisualAttribute(attribute: JSXAttribute, actual: ValueType, directive: "look" | "style"): void {
    const property = attribute.name.slice(`${directive}:`.length);
    if (!property) {
      this.diagnostics.push(diagnostic("VEL5038", `A ${directive}: directive requires a camelCase Look property name`, attribute.span));
      return;
    }
    if (attribute.value === null) {
      this.diagnostics.push(diagnostic("VEL5040", `JSX ${directive}:${property} requires a string or expression value`, attribute.span));
      return;
    }
    const expression = typeof attribute.value === "string"
      ? { kind: "LiteralExpression", value: attribute.value, raw: JSON.stringify(attribute.value), span: attribute.span } as const
      : attribute.value;
    if (!this.analyzeLookValue(property, expression, attribute.span, directive)) return;
    const expected = LOOK_PROPERTY_TYPES.get(property) ?? stringType;
    if (mentionsLookUnitType(expected) && lookLiteralZero(expression)) return;
    if (this.reportLookNumberWithoutUnit(property, actual, expected, expression.span)) return;
    if (expected.kind !== "unknown") this.requireAssignable(actual, optionalOf(expected), expression.span);
  }
}

function webTypeFields(name: string): ReadonlyMap<string, ValueType> | null {
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

function webEventType(name: string): ValueType {
  if (name === "keydown" || name === "keyup" || name === "keypress") return { kind: "named", name: "KeyboardEvent" };
  if (["click", "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave"].includes(name)) return { kind: "named", name: "PointerEvent" };
  if (name === "beforeinput" || name === "input") return { kind: "named", name: "InputEvent" };
  if (name === "compositionstart" || name === "compositionupdate" || name === "compositionend") return { kind: "named", name: "CompositionEvent" };
  if (name === "copy" || name === "cut" || name === "paste") return { kind: "named", name: "ClipboardEvent" };
  return { kind: "named", name: "Event" };
}
