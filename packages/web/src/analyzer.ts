import { semanticTypeIdentity, type Diagnostic, type Span } from "@velarscript/compiler";
import {
  Analyzer,
  anyType,
  boolType,
  describeType,
  expressionContainsDirectAwait,
  invalidType,
  isInvalidType,
  isAssignable,
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
import {
  LOOK_ABSENT_MEDIA_SUBJECTS,
  LOOK_ARITHMETIC_HINT,
  LOOK_ANIMATION_DIRECTIONS,
  LOOK_ANIMATION_EASINGS,
  LOOK_ANIMATION_FILLS,
  LOOK_BORDER_STYLE_NAMES,
  LOOK_BUILDER_NUMERIC_RANGES,
  LOOK_BUILDERS,
  LOOK_EXCLUDED_PROPERTIES,
  LOOK_HOOKS,
  LOOK_LENGTH_BUILDERS,
  LOOK_MEDIA_LENGTH_UNITS,
  LOOK_MEDIA_SUBJECTS,
  LOOK_NUMERIC_TYPE_NAMES,
  LOOK_NON_ANIMATABLE_PROPERTIES,
  LOOK_PROPERTIES,
  LOOK_PROPERTY_KEYWORDS,
  LOOK_PROPERTY_VALUE_KINDS,
  LOOK_TARGETS,
  LOOK_UNIT_TYPES,
  LOOK_UNITLESS_PROPERTIES,
  nearestLookName,
  type LookPropertyValueKind,
} from "./look.ts";
import { collectLookStaticValues, evaluateLookStaticExpression, isLookStaticValue, type LookStaticValue } from "./look-static.ts";
import { keyframeCssValue } from "./keyframes.ts";
import { dynamicChildLeaves } from "./emitter.ts";
import { isWebCustomElementName, WEB_NATIVE_ELEMENTS } from "./elements.ts";
import {
  isWebExpression,
  isWebJsx,
  isWebKeyframes,
  isWebLook,
  isWebStatement,
  isWebUnit,
  type WebActionDeclaration as ActionDeclaration,
  type WebComponentDeclaration as ComponentDeclaration,
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
  type WebKeyframesExpression,
  type WebLookExpression,
  type WebResourceDeclaration as ResourceDeclaration,
} from "./ast.ts";
import {
  isWebComponentConstructor,
  isWebComponentType,
  isWebNodeType,
  normalizeWebComponentType,
  webComponentConstructor,
  webComponentHandle,
  webComponentIntrinsic,
  webComponentName,
  webNodeType,
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
const textualWebPrimitiveNames = new Set(["Length", "Percentage", "LengthPercentage", "TrackFraction", "Color", "Duration", "Angle"]);
const webEventTypeNames = new Set(["Event", "KeyboardEvent", "PointerEvent", "InputEvent", "CompositionEvent", "ClipboardEvent"]);
const webEventDeadFields = new Set(["target", "currentTarget", "value", "checked"]);
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });
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
    case "angle": return lookAngle;
    case "background": return { kind: "union", members: [lookColor, lookImage, stringType] };
    case "border": return { kind: "union", members: [lookBorder, stringType] };
    case "color": return { kind: "union", members: [lookColor, stringType] };
    case "duration": return lookDuration;
    case "image": return { kind: "union", members: [lookImage, stringType] };
    case "line-height": return { kind: "union", members: [numberType, lookLength, stringType] };
    case "metric": return { kind: "union", members: [lookMetricOrSpacing, stringType] };
    case "number": return numberType;
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
    case "reactive.computed": {
      arity(1, 1);
      const callback = callbackAt(0, [], unknownType);
      if (callback.kind === "any") return { kind: "function", parameters: [], requiredParameters: 0, result: anyType };
      if (callback.kind !== "function" && callback.kind !== "intrinsic") {
        context.typeError("computed requires a synchronous zero-argument function", argumentAt(0)?.span ?? callSpan);
        return { kind: "function", parameters: [], requiredParameters: 0, result: unknownType };
      }
      const result = callback.result;
      if (context.expandAliases(result).kind === "promise") {
        context.typeError("computed cannot cache a Promise; load asynchronous data with a resource", argumentAt(0)?.span ?? callSpan);
      }
      return { kind: "function", parameters: [], requiredParameters: 0, result };
    }
    case "web.route": {
      arity(2, 2);
      inferAt(0, stringType);
      const component = inferAt(1);
      const path = argumentAt(0);
      if (path?.kind === "LiteralExpression" && typeof path.value === "string") checkRoutePath(path.value, path.span, context);
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
      if (loader.kind !== "function" && loader.kind !== "any") {
        if (loaderExpression) context.typeError(`Expected a module loader, received ${describeType(loader)}`, loaderExpression.span);
        return anyType;
      }
      if (loader.kind === "any") return anyType;
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
    case "realtime.sendJson": {
      arity(1, 1);
      const value = inferAt(0);
      const valueExpression = argumentAt(0);
      if (context.jsonSerializable(value) === false && valueExpression) context.typeError(`Realtime JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, valueExpression.span);
      return nullType;
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
const lookBorderStyles = new Set(["solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "none", "hidden"]);

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

const lookCssWideKeywords = new Set(["inherit", "initial", "revert", "revert-layer", "unset"]);
const lookMetricKeywords = new Set([...lookCssWideKeywords, "auto", "none", "normal", "min-content", "max-content", "fit-content", "stretch"]);
const lookDefaultKeywords = new Set([
  ...lookCssWideKeywords, "auto", "none", "normal", "start", "end", "center", "left", "right", "top", "bottom",
  "solid", "dashed", "dotted", "double", "hidden", "visible", "round", "square", "butt", "miter", "bevel",
  "row", "column", "dense", "both", "mandatory", "proximity", "always", "smooth", "thin", "light", "dark",
  "disc", "circle", "decimal", "inside", "outside", "bold", "bolder", "lighter", "small-caps",
]);
const lookColorKeywords = new Set([
  ...lookCssWideKeywords, "transparent", "currentColor", "black", "silver", "gray", "white", "maroon", "red", "purple",
  "fuchsia", "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "orange", "aliceblue", "rebeccapurple",
]);

function literalLookStrings(expression: Expression): readonly string[] | null {
  if (expression.kind === "LiteralExpression") return typeof expression.value === "string" ? [expression.value] : [];
  if (expression.kind === "ConditionalExpression") {
    const thenValues = literalLookStrings(expression.thenValue);
    const elseValues = literalLookStrings(expression.elseValue);
    return thenValues && elseValues ? [...thenValues, ...elseValues] : null;
  }
  return null;
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
 * A canonical rendering of one Look condition, so two sibling blocks that lower
 * to the same selector and media query share a duplicate-detection scope.
 */
function lookConditionSignature(expression: Expression): string {
  if (isWebExpression(expression) && expression.kind === "ExtensionExpression:web:look-hook") return `@${expression.name}`;
  if (expression.kind === "UnaryExpression" && expression.operator === "not") return `!(${lookConditionSignature(expression.operand)})`;
  if (expression.kind === "BinaryExpression" && (expression.operator === "and" || expression.operator === "or")) {
    return `(${lookConditionSignature(expression.left)}${expression.operator}${lookConditionSignature(expression.right)})`;
  }
  if (expression.kind === "BinaryExpression") return `(${lookConditionSignature(expression.left)}${expression.operator}${lookConditionSignature(expression.right)})`;
  if (expression.kind === "MemberExpression") return `${lookConditionSignature(expression.object)}.${expression.property}`;
  if (expression.kind === "IdentifierExpression") return `id:${expression.name}`;
  if (isWebUnit(expression)) return `${expression.value}${expression.unit}`;
  if (expression.kind === "LiteralExpression") return `lit:${expression.raw}`;
  return `span:${expression.span.start}`;
}

/**
 * Every name in a module or component body whose read is reactive but whose
 * binding is not itself a state/prop reference: a computed accessor, a resource
 * handle, an action handle. A Look literal that reads one of these freezes it
 * exactly as it freezes a state read (LOK-D1).
 */
function collectDerivedReactiveNames(program: Program): ReadonlySet<string> {
  const names = new Set<string>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "VariableDeclaration" && statement.pattern.kind === "NameBindingPattern"
        && statement.initializer.kind === "CallExpression" && statement.initializer.callee.kind === "IdentifierExpression"
        && statement.initializer.callee.name === "computed") {
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

function firstRelativeCssUrl(source: string): string | null {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, "");
  const pattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/giu;
  for (const match of withoutComments.matchAll(pattern)) {
    const value = match[2]!.trim();
    if (value.startsWith("/") || value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(value)) continue;
    return value;
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
  let sanitized = "";
  let quote = "";
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1] ?? "";
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; sanitized += "  "; index += 1; }
      else sanitized += character === "\n" ? "\n" : " ";
      continue;
    }
    if (quote) {
      if (character === "\\") { sanitized += "  "; index += 1; continue; }
      if (character === quote) quote = "";
      sanitized += " ";
      continue;
    }
    if (character === "/" && next === "*") { blockComment = true; sanitized += "  "; index += 1; continue; }
    if (character === "\"" || character === "'") { quote = character; sanitized += " "; continue; }
    sanitized += character;
  }
  return /(^|[;}\s])@import\b/iu.test(sanitized);
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

function checkRoutePath(path: string, sourceSpan: Span, context: CompilerIntrinsicAnalysisContext): void {
  if (!path.startsWith("/")) context.typeError("A route path must start with '/'", sourceSpan);
  if (path.includes("?") || path.includes("#")) context.typeError("A route path describes only a pathname; read query and hash from RouteContext", sourceSpan);
  if (path.includes("\\")) context.typeError("A route path cannot contain a backslash", sourceSpan);
  if (path.length > 1 && path.endsWith("/")) context.typeError("A route path cannot end with '/'; matching already accepts one trailing slash", sourceSpan);
  const segments = path.split("/").slice(1);
  const parameters = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0 && path !== "/") context.typeError("A route path cannot contain an empty segment", sourceSpan);
    if (segment === "*") {
      if (index !== segments.length - 1) context.typeError("A route wildcard must be the final segment", sourceSpan);
      if (parameters.has("wildcard")) context.typeError("A route parameter named 'wildcard' conflicts with the '*' capture", sourceSpan);
      parameters.add("wildcard");
      continue;
    }
    if (segment.includes("*")) context.typeError("A route wildcard must occupy its whole final segment", sourceSpan);
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) context.typeError("A route parameter requires a valid name", sourceSpan);
    else if (parameters.has(name)) context.typeError(`Route parameter '${name}' is repeated`, sourceSpan);
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

export class VelarWebAnalyzer extends Analyzer {
  private componentStates: Set<string> | null = null;
  private mountedDepth = 0;
  private synchronousReactiveDepth = 0;
  private jsxDepth = 0;
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
  private lookLiteralDepth = 0;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.resources = context.resources ?? new Map();
    this.importedLookStaticValues = new Map(
      [...(context.extensionImports?.get("@velarscript/web") ?? [])]
        .filter((entry): entry is [string, LookStaticValue] => isLookStaticValue(entry[1])),
    );
  }

  override analyze(program: Program): readonly Diagnostic[] {
    this.lookStaticValues = collectLookStaticValues(program, this.importedLookStaticValues);
    this.lookBuilderNames = collectLookBuilderNames(program);
    for (const name of collectDerivedReactiveNames(program)) this.derivedReactiveNames.add(name);
    super.analyze(program);
    this.reportStaticJsxKeys();
    return this.diagnostics;
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
        this.declareBinding(statement.name, true, declared, statement.span);
        this.markDeclaredBindingReactive(statement.name, "state");
        return true;
      }
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
        // LOK-D2: a stylesheet import is a module-level ordering declaration.
        // Nested inside a component or a function it used to pass every check,
        // build, and then appear in no output at all.
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL5037", "CSS imports are module-level; move 'import css unsafe' to the top of the module so its order against Look stays visible", statement.span));
          return true;
        }
        if (this.unsafeCssImports.has(statement.source)) {
          this.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source}' is imported more than once; each stylesheet must have one explicit order position`, statement.span));
        }
        this.unsafeCssImports.add(statement.source);
        const source = this.resources.get(statement.source);
        if (source && containsCssImport(source)) {
          this.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source}' contains @import; declare every stylesheet with 'import css unsafe' so project order remains visible`, statement.span));
        }
        if (source) {
          const relativeUrl = firstRelativeCssUrl(source);
          if (relativeUrl) this.diagnostics.push(diagnostic("VEL5037", `Unsafe CSS '${statement.source}' uses relative url(${JSON.stringify(relativeUrl)}); use a project-public /path, data URL, fragment, or absolute URL so extracted asset ownership stays explicit`, statement.span));
        }
        return true;
      }
      default:
        return false;
    }
  }

  protected override prescanExtensionScopeDeclaration(statement: Statement): { readonly name: string; readonly span: Span } | null {
    if (!isWebStatement(statement)) return null;
    return statement.kind === "ExtensionStatement:web:state" || statement.kind === "ExtensionStatement:web:resource"
      ? { name: statement.name, span: statement.span }
      : null;
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
    const result = super.inferExpression(expression, contextualType);
    if (expression.kind === "CallExpression") this.checkLookBuilderCall(expression);
    return result;
  }

  // A name refers to writable reactive state only when ordinary lexical lookup
  // still resolves it to the state binding; a shadowing local wins instead.
  private writableStateName(name: string): boolean {
    return this.reactiveBindingKind(name) === "state";
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
    if (this.componentStates !== null && this.mountedDepth === 0 && this.inComponentSetupPosition()) {
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
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, this.readonlyPropType(this.resolveValidatedAnnotation(parameter.type))]));
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
    this.enterScope();
    this.flowFrameDepth += 1;
    const previousStates = this.componentStates;
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "ExtensionStatement:web:state").map((item) => item.name));
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
      // D44 rule 72: props are readonly data views. A bare class prop stays
      // legal — it is visibly behavioral and passes through unprotected — but
      // a class buried inside a data prop is rejected like explicit readonly.
      if (valid) {
        const buried = this.buriedClassInPropData(type);
        if (buried) {
          this.diagnostics.push(diagnostic(
            "VEL4001",
            `A component prop is a readonly data view; '${parameter.name}${buried.suffix}' is class '${buried.className}' — lift the class into its own prop, or model it as a data record`,
            parameter.span,
          ));
        }
      }
      this.declareBinding(parameter.name, false, this.readonlyPropType(valid ? type : this.resolveValidatedAnnotation(parameter.type)), parameter.span);
      this.markDeclaredBindingReactive(parameter.name, "prop");
      if (parameter.name === "ref") this.diagnostics.push(diagnostic("VEL5056", "'ref' is a compiler-owned JSX directive and cannot be declared as a component prop", parameter.span));
    }
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
        this.declareBinding(item.name, true, declared, item.span);
        this.markDeclaredBindingReactive(item.name, "state");
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
        this.enterScope();
        if (item.currentName) this.declareBinding(item.currentName, false, watched, item.span);
        if (item.previousName) this.declareBinding(item.previousName, false, watched, item.span);
        this.analyzeStatements(item.body);
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
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
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
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.constructorDepth = outerConstructorDepth;
  }

  private readonlyPropType(type: ValueType): ValueType {
    return this.readonlyDataViewOf(type);
  }

  /**
   * A class visible at the top of a prop annotation (through optionals and
   * unions) is a behavioral value the reader can see; a class below a data
   * node hides behind the readonly promise and is rejected (D44 rule 72).
   */
  private buriedClassInPropData(type: ValueType): { readonly suffix: string; readonly className: string } | null {
    const resolved = this.expandAliases(type);
    if (resolved.kind === "class" || resolved.kind === "classConstructor") return null;
    if (resolved.kind === "optional") return this.buriedClassInPropData(resolved.inner);
    if (resolved.kind === "union") {
      for (const member of resolved.members) {
        const found = this.buriedClassInPropData(member);
        if (found) return found;
      }
      return null;
    }
    return this.findClassInReadonlyData(resolved);
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
      (value) => this.readonlyPropType(this.normalizeComponentContracts(value)),
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
        const signature = lookConditionSignature(entry.condition);
        this.analyzeLookEntries(entry.thenEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * thenTerms), `${scopeKey}&${signature}`);
        this.analyzeLookEntries(entry.elseEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * elseTerms), `${scopeKey}&!${signature}`);
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
      : expression.callee.kind === "MemberExpression"
        && expression.callee.object.kind === "IdentifierExpression"
        && expression.callee.object.name === "Look"
        && this.isBuiltinValueReference(expression.callee.object, "Look")
        && LOOK_BUILDERS.has(expression.callee.property)
        ? expression.callee.property
        : undefined;
    if (!builder) return;
    const key = spanIdentity(expression.span);
    if (this.checkedBuilderCalls.has(key)) return;
    this.checkedBuilderCalls.add(key);
    if (builder === "animate") {
      this.checkAnimateBuilderCall(expression);
      return;
    }
    const ranges = LOOK_BUILDER_NUMERIC_RANGES.get(builder);
    for (const [index, argument] of expression.arguments.entries()) {
      const named = expression.argumentNames?.[index] ?? null;
      const position = named ? -1 : index;
      const range = position >= 0 ? ranges?.[position] : undefined;
      const literal = argument.kind === "LiteralExpression" && typeof argument.value === "number" ? argument.value
        : argument.kind === "UnaryExpression" && argument.operator === "-" && argument.operand.kind === "LiteralExpression" && typeof argument.operand.value === "number"
          ? -argument.operand.value : null;
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
    }
    if (builder === "tracks" && expression.arguments.length > 1024) {
      this.diagnostics.push(diagnostic("VEL5042", "tracks cannot contain more than 1024 values", expression.span));
    }
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
      this.diagnostics.push(diagnostic("VEL5060", "animate accepts either count or loop, not both; use loop=true for an infinite animation", expression.span));
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
        if (keyframeCssValue(entry.value) === null) {
          this.diagnostics.push(diagnostic(
            "VEL5060",
            "A keyframe value must resolve to static CSS from literals, unit values, arithmetic, or velar/look builders",
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
    if (!this.validateLookStringVocabulary(name, value)) return false;
    return true;
  }

  private validateLookStringVocabulary(name: string, value: Expression): boolean {
    const kind = LOOK_PROPERTY_VALUE_KINDS.get(name);
    if (!kind || kind === "text" || kind === "filter" || kind === "transform" || kind === "animation") return true;
    const values = literalLookStrings(value);
    if (values === null) return true;
    for (const text of values) {
      const normalized = text.trim();
      if (kind === "metric" && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vw|vh|vmin|vmax|%|fr|ms|s|deg|turn)$/u.test(normalized)) {
        this.diagnostics.push(diagnostic(
          "VEL5038",
          `Use the unit literal ${normalized}; quoted unit values are not part of Look`,
          value.span,
        ));
        return false;
      }
      let accepted: boolean;
      if (kind === "metric") accepted = lookMetricKeywords.has(normalized);
      else if (kind === "color" || kind === "background") accepted = lookColorKeywords.has(normalized) || /^#[0-9a-f]{3,8}$/iu.test(normalized);
      else if (kind === "image" || kind === "border" || kind === "shadow") accepted = lookCssWideKeywords.has(normalized) || normalized === "none";
      else if (kind === "number-keyword" || kind === "line-height") accepted = lookDefaultKeywords.has(normalized);
      else {
        const propertyKeywords = LOOK_PROPERTY_KEYWORDS.get(name);
        accepted = propertyKeywords?.has(normalized) ?? lookDefaultKeywords.has(normalized);
      }
      if (!accepted) {
        const expected = kind === "color" || kind === "background" ? "a checked color() or color keyword"
          : kind === "image" ? "a checked image builder such as linearGradient() or asset()"
            : kind === "metric" ? "a unit value or one of the property's CSS keywords"
              : `one of the closed ${name} keywords`;
        this.diagnostics.push(diagnostic("VEL5038", `Look property '${name}' does not accept '${normalized}'; use ${expected}`, value.span));
        return false;
      }
    }
    return true;
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
        }
      } else if (child.kind === "ExtensionExpression:web:jsx") {
        this.inferJsx(child);
      }
    }
    this.jsxDepth -= 1;
    return webNodeType;
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
      if (leaf.list.key) honoredKeyRoots.add(leaf.list.arrow.body);
      else this.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", leaf.list.arrow.body.span));
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
    else if (hasChildren && !component.properties.has("children")) this.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children`, expression.span));
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
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
      if (isWebComponentConstructor(component) && webComponentIntrinsic(component) === "web.router" && attribute.name === "fallback" && actual.kind !== "null" && actual.kind !== "any") {
        this.checkWebRouteComponent(actual, attribute.span, "A Router fallback");
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
    } else if (attribute.name === "bind") {
      this.diagnostics.push(diagnostic("VEL5019", "Use 'bind:value={name}'; the bind directive names the bound property, such as bind:value or bind:checked", attribute.span));
    } else if (/^on[A-Z]/u.test(attribute.name)) {
      if (attribute.name === "onEnter") {
        this.diagnostics.push(diagnostic("VEL5025", "Use 'on:keydown' with a handler that checks 'event.key == \"Enter\"'; VelarScript has no dedicated enter-key event", attribute.span));
      } else {
        const camel = attribute.name.slice(2);
        const event = camel === "DoubleClick" || camel === "DblClick" ? "dblclick" : camel.toLowerCase();
        this.diagnostics.push(diagnostic("VEL5025", nativeDomEventNames.has(event)
          ? `Use 'on:${event}'; VelarScript event attributes use the on: directive`
          : "Use an 'on:event' directive with a native DOM event name, such as 'on:click' or 'on:keydown'", attribute.span));
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
    } else if (!isInvalidType(inferred) && !this.isJsxAttributeValue(inferred)) {
      this.diagnostics.push(diagnostic("VEL5047", `Native JSX attributes require text, finite numbers, bool, enums, or null; received ${describeType(inferred)}`, attribute.span));
    }
    if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
      && !expression.attributes.some((item) => item.name === "role")) this.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
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

  private checkWebRouteComponent(type: ValueType, sourceSpan: Span, subject: string): void {
    if (isInvalidType(type)) return;
    if (!isWebComponentType(type)) {
      if (type.kind !== "any") this.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
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
  if (name === "KeyboardEvent") return new Map([...eventFields(), ["key", stringType], ["code", stringType], ["repeat", boolType], ["altKey", boolType], ["ctrlKey", boolType], ["metaKey", boolType], ["shiftKey", boolType]]);
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
