import { semanticTypeIdentity, type Diagnostic, type Span } from "@velarscript/compiler";
import {
  Analyzer,
  anyType,
  boolType,
  describeType,
  expressionContainsDirectAwait,
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
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { LOOK_BUILDERS, LOOK_HOOKS, LOOK_PROPERTIES, LOOK_TARGETS } from "./look.ts";
type ComponentDeclaration = Extract<Statement, { kind: "ComponentDeclaration" }>;
type ActionDeclaration = Extract<Statement, { kind: "ActionDeclaration" }>;
type ResourceDeclaration = Extract<Statement, { kind: "ResourceDeclaration" }>;
type JSXElementExpression = Extract<Expression, { kind: "JSXElementExpression" }>;
type JSXAttribute = JSXElementExpression["attributes"][number];

const removedJsxControlAttributes = new Set(["if", "else-if", "else"]);
const nativeDomEventNames = new Set([
  "click", "dblclick", "input", "beforeinput", "change", "submit", "reset", "invalid", "select", "toggle", "close",
  "keydown", "keyup", "keypress", "focus", "blur", "focusin", "focusout", "scroll", "wheel",
  "mousedown", "mouseup", "mousemove", "mouseenter", "mouseleave", "mouseover", "mouseout", "contextmenu",
  "pointerdown", "pointerup", "pointermove", "pointerenter", "pointerleave", "pointerover", "pointerout", "pointercancel",
  "touchstart", "touchend", "touchmove", "touchcancel",
  "dragstart", "dragend", "dragover", "dragenter", "dragleave", "drop", "drag",
  "copy", "cut", "paste", "load", "error", "transitionend", "animationend", "play", "pause", "ended",
]);
const textualWebPrimitiveNames = new Set(["Length", "Percentage", "Color", "Duration", "Angle", "Opacity"]);
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });
const LOOK_CONDITION_TERM_LIMIT = 32;

const lookLength: ValueType = { kind: "named", name: "Length" };
const lookPercentage: ValueType = { kind: "named", name: "Percentage" };
const lookMetric: ValueType = { kind: "union", members: [numberType, lookLength, lookPercentage] };
const lookColor: ValueType = { kind: "named", name: "Color" };
const lookImage: ValueType = { kind: "named", name: "Image" };
const lookBorder: ValueType = { kind: "named", name: "Border" };
const lookShadow: ValueType = { kind: "named", name: "Shadow" };
const lookDuration: ValueType = { kind: "named", name: "Duration" };
const lookAngle: ValueType = { kind: "named", name: "Angle" };
const lookTrackList: ValueType = { kind: "named", name: "TrackList" };
const lookTransition: ValueType = { kind: "named", name: "Transition" };
const lookSpacing: ValueType = { kind: "named", name: "Spacing" };
const lookMetricOrSpacing: ValueType = { kind: "union", members: [lookMetric, lookSpacing] };
const LOOK_PROPERTY_TYPES = new Map<string, ValueType>([
  ...["gap", "rowGap", "columnGap", "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "inset", "top", "right", "bottom", "left", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "paddingInline", "paddingBlock", "margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "marginInline", "marginBlock", "borderRadius", "fontSize", "letterSpacing", "translate", "flexBasis", "borderWidth"].map((name) => [name, { kind: "union", members: [lookMetricOrSpacing, stringType] } as ValueType] as const),
  ["gridTemplateColumns", { kind: "union", members: [lookTrackList, stringType] }], ["gridTemplateRows", { kind: "union", members: [lookTrackList, stringType] }],
  ["background", { kind: "union", members: [lookColor, lookImage, stringType] }], ["backgroundColor", { kind: "union", members: [lookColor, stringType] }], ["backgroundImage", { kind: "union", members: [lookImage, stringType] }], ["fill", { kind: "union", members: [lookColor, stringType] }], ["stroke", { kind: "union", members: [lookColor, stringType] }], ["strokeWidth", { kind: "union", members: [lookMetric, stringType] }],
  ["border", { kind: "union", members: [lookBorder, stringType] }], ["borderTop", { kind: "union", members: [lookBorder, stringType] }], ["borderRight", { kind: "union", members: [lookBorder, stringType] }], ["borderBottom", { kind: "union", members: [lookBorder, stringType] }], ["borderLeft", { kind: "union", members: [lookBorder, stringType] }], ["outline", { kind: "union", members: [lookBorder, stringType] }], ["boxShadow", { kind: "union", members: [lookShadow, stringType] }],
  ["color", { kind: "union", members: [lookColor, stringType] }], ["content", stringType], ["font", stringType], ["fontFamily", stringType],
  ["opacity", numberType], ["zIndex", numberType], ["fontWeight", { kind: "union", members: [numberType, stringType] }], ["aspectRatio", { kind: "union", members: [numberType, stringType] }], ["scale", { kind: "union", members: [numberType, lookSpacing, stringType] }],
  ["flexGrow", numberType], ["flexShrink", numberType], ["order", numberType],
  ["lineHeight", { kind: "union", members: [numberType, lookLength] }], ["rotate", lookAngle],
  ["transition", { kind: "union", members: [lookTransition, stringType] }], ["transitionDuration", lookDuration], ["transitionDelay", lookDuration], ["animation", stringType], ["backdropFilter", stringType],
]);

export function inferWebIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt } = context;
  switch (intrinsic.name) {
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
      if (exported.kind !== "componentConstructor") {
        context.typeError(`Dynamic export '${name}' is ${describeType(exported)}, not a component`, nameExpression?.span ?? callSpan);
        return anyType;
      }
      const loadingExpression = argumentAt(2);
      if (loadingExpression && !isInvalidType(loadingFallback) && loadingFallback.kind !== "null" && loadingFallback.kind !== "any") {
        if (loadingFallback.kind !== "componentConstructor") context.typeError("A lazy loading fallback must be a component", loadingExpression.span);
        else if (loadingFallback.requiredProps.size > 0) context.typeError("A lazy loading fallback cannot require props", loadingExpression.span);
      }
      const failedExpression = argumentAt(3);
      if (failedExpression && !isInvalidType(failedFallback) && failedFallback.kind !== "null" && failedFallback.kind !== "any") {
        if (failedFallback.kind !== "componentConstructor") context.typeError("A lazy failure fallback must be a component accepting error: Error", failedExpression.span);
        else {
          const error = failedFallback.props.get("error");
          if (!error || !context.isAssignable({ kind: "class", name: "Error" }, error) || [...failedFallback.requiredProps].some((prop) => prop !== "error")) {
            context.typeError("A lazy failure fallback must accept error: Error and require no other props", failedExpression.span);
          }
        }
      }
      return exported;
    }
    case "http.parse":
      arity(1, 1);
      return { kind: "promise", value: runtimeTypeAt(0) };
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
      arity(2, 2);
      inferAt(0, stringType);
      const value = inferAt(1);
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
      arity(2, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(2)) { inferAt(2, parsed); return parsed; }
      return optionalOf(parsed);
    }
    case "storage.databaseGet": {
      arity(2, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (argumentAt(2)) { inferAt(2, parsed); return { kind: "promise", value: parsed }; }
      return { kind: "promise", value: optionalOf(parsed) };
    }
    case "storage.watch": {
      arity(3, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      callbackAt(2, [optionalOf(parsed), optionalOf(parsed)], unknownType);
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

function isViewportCondition(expression: Expression): boolean {
  if (expression.kind !== "BinaryExpression" || !["<", "<=", ">", ">="].includes(expression.operator)) return false;
  if (expression.left.kind !== "MemberExpression" || expression.left.object.kind !== "IdentifierExpression" || expression.left.object.name !== "viewport") return false;
  if (expression.left.property !== "width" && expression.left.property !== "height") return false;
  return expression.right.kind === "UnitLiteralExpression" && ["px", "rem", "em"].includes(expression.right.unit);
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
  return type.kind === "named" && ["Length", "Percentage", "Duration", "Angle", "Opacity"].includes(type.name);
}

function isLookMetricPair(left: ValueType, right: ValueType): boolean {
  return left.kind === "named" && right.kind === "named"
    && ["Length", "Percentage"].includes(left.name)
    && ["Length", "Percentage"].includes(right.name);
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
  if (type.kind !== "componentConstructor") {
    if (type.kind !== "any") context.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
    return;
  }
  const unsupported = [...type.requiredProps].filter((name) => name !== "route");
  if (unsupported.length > 0) context.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
  const routeProp = type.props.get("route");
  if (routeProp && !context.isAssignable({ kind: "named", name: "RouteContext" }, routeProp)) context.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
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
  if (type.kind === "union") return type.members.some(containsPromise);
  return false;
}

function jsxMapExpression(expression: Expression): (Extract<Expression, { kind: "ArrowFunctionExpression" }> & { readonly body: JSXElementExpression }) | null {
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression" || expression.callee.property !== "map") return null;
  const callback = expression.arguments[0];
  return callback?.kind === "ArrowFunctionExpression" && !callback.asynchronous && callback.body.kind === "JSXElementExpression"
    ? callback as typeof callback & { readonly body: JSXElementExpression }
    : null;
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
  return expression.children.some((child) => child.kind === "JSXElementExpression"
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

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.resources = context.resources ?? new Map();
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (statement.kind === "UnsafeCssImportDeclaration") return true;
    if (statement.kind !== "ComponentDeclaration") return false;
    this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    switch (statement.kind) {
      case "ComponentDeclaration":
        this.analyzeComponent(statement);
        return true;
      case "StateDeclaration":
      case "ComputedDeclaration": {
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3010", `'${statement.kind === "StateDeclaration" ? "state" : "computed"}' is only valid at module or component scope`, statement.span));
          return true;
        }
        const annotationValid = statement.type ? this.validateTypeReference(statement.type) : true;
        const annotationContext = statement.type ? this.resolveValidatedAnnotation(statement.type) : null;
        if (statement.kind === "ComputedDeclaration") {
          this.flowFrameDepth += 1;
          this.synchronousReactiveDepth += 1;
        }
        const actual = this.inferExpression(statement.initializer, annotationContext ?? unknownType);
        if (statement.kind === "ComputedDeclaration") {
          this.synchronousReactiveDepth -= 1;
          this.flowFrameDepth -= 1;
        }
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, statement.initializer.span);
        const kind = statement.kind === "StateDeclaration" ? "state" : "computed";
        this.declareBinding(statement.name, kind === "state", declared, statement.span);
        this.reactiveBindings.set(statement.name, kind);
        return true;
      }
      case "ResourceDeclaration":
        this.diagnostics.push(diagnostic("VEL3012", "'resource' is only valid at component scope", statement.span));
        this.analyzeResourceDeclaration(statement);
        return true;
      case "ActionDeclaration":
        this.diagnostics.push(diagnostic("VEL3013", "'action' is only valid at component scope", statement.span));
        this.analyzeActionDeclaration(statement);
        return true;
      case "WatchDeclaration":
        if (!this.isTopLevelScope()) {
          this.diagnostics.push(diagnostic("VEL3010", "'watch' is only valid at module or component scope", statement.span));
          return true;
        }
        this.flowFrameDepth += 1;
        this.synchronousReactiveDepth += 1;
        {
          const watched = this.inferExpression(statement.expression);
          this.enterScope();
          if (statement.currentName) this.declareBinding(statement.currentName, false, watched, statement.span);
          if (statement.previousName) this.declareBinding(statement.previousName, false, watched, statement.span);
          this.analyzeStatements(statement.body);
          this.exitScope();
        }
        this.synchronousReactiveDepth -= 1;
        this.flowFrameDepth -= 1;
        return true;
      case "VariableDeclaration": {
        const reactive = this.mutableReactiveReferences(statement.initializer)[0];
        if (reactive) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${reactive.name}' cannot be aliased; derive a new value or use copy() before local mutation`,
            statement.initializer.span,
          ));
        }
        return false;
      }
      case "ReturnStatement": {
        const reactive = statement.value ? this.mutableReactiveReferences(statement.value)[0] : null;
        if (reactive) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${reactive.name}' cannot escape by reference; return a derived value or an explicit copy`,
            statement.value!.span,
          ));
        }
        return false;
      }
      case "AssignmentStatement": {
        const target = statement.target;
        const root = target.kind === "MemberExpression" || target.kind === "IndexExpression"
          ? this.reactiveReference(target.object)
          : null;
        if (root) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${root.name}' updates by assigning a new value to the state binding; nested mutation is intentionally not reactive`,
            target.span,
          ));
        }
        const value = this.mutableReactiveReferences(statement.value)[0];
        if (value
          && !(target.kind === "IdentifierExpression" && target.name === value.name)) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${value.name}' cannot be assigned into another alias; assign a derived value or an explicit copy`,
            statement.value.span,
          ));
        }
        return false;
      }
      case "UnsafeCssImportDeclaration": {
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

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && expression.callee.name === "mount") {
      const namedNode = expression.argumentNames?.findIndex((name) => name === "node") ?? -1;
      const node = expression.arguments[namedNode >= 0 ? namedNode : 0];
      if (node && expressionContainsDirectAwait(node, (value) => value.kind === "JSXElementExpression" ? false : undefined)) {
        this.diagnostics.push(diagnostic(
          "VEL4007",
          "mount constructs its root synchronously; await the root in a separate module binding before calling mount",
          node.span,
        ));
      }
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression"
      && this.reactiveReference(expression.callee.object)
      && ["append", "extend", "insert", "pop", "add", "set", "update", "remove", "clear"].includes(expression.callee.property)) {
      const reactive = this.reactiveReference(expression.callee.object)!;
      this.diagnostics.push(diagnostic(
        "VEL5046",
        `Reactive state '${reactive.name}' updates by assigning a new value to the state binding; mutating collection calls do not publish state`,
        expression.span,
      ));
    }
    if (expression.kind === "CallExpression" && !this.safeReactiveCopyCall(expression)) {
      for (const argument of expression.arguments) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        for (const reactive of this.mutableReactiveReferences(value)) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${reactive.name}' cannot cross an ordinary call by mutable reference; pass a derived value or an explicit copy`,
            value.span,
          ));
        }
      }
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && LOOK_BUILDERS.has(expression.callee.name) && !this.lookup(expression.callee.name)) {
      this.extensionCalls.set(spanIdentity(expression.span), expression.callee.name);
    }
    if (expression.kind === "UnaryExpression" && (expression.operator === "+" || expression.operator === "-")) {
      const operand = this.inferExpression(expression.operand);
      if (isLookNumericType(operand)) return operand;
      this.probedOperandTypes.set(spanIdentity(expression.operand.span), operand);
    }
    if (expression.kind === "BinaryExpression" && ["+", "-", "*", "/"].includes(expression.operator)) {
      const left = this.inferExpression(expression.left);
      const right = this.inferExpression(expression.right);
      if (!isLookNumericType(left) && !isLookNumericType(right)) {
        this.probedOperandTypes.set(spanIdentity(expression.left.span), left);
        this.probedOperandTypes.set(spanIdentity(expression.right.span), right);
      } else {
        if ((expression.operator === "+" || expression.operator === "-") && semanticTypeIdentity(left) === semanticTypeIdentity(right)) return left;
        if ((expression.operator === "+" || expression.operator === "-") && isLookMetricPair(left, right)) return lookLength;
        if ((expression.operator === "*" || expression.operator === "/") && isLookNumericType(left) && right.kind === "number") return left;
        if (expression.operator === "*" && left.kind === "number" && isLookNumericType(right)) return right;
        this.diagnostics.push(diagnostic("VEL5042", `Look unit arithmetic cannot apply '${expression.operator}' to ${describeType(left)} and ${describeType(right)}`, expression.span));
        return unknownType;
      }
    }
    if (expression.kind === "JSXElementExpression") return this.inferJsx(expression);
    if (expression.kind === "LookExpression") {
      this.analyzeLookEntries(expression.entries, false, false, 1);
      return { kind: "named", name: "Look" };
    }
    if (expression.kind === "LookHookExpression") {
      this.diagnostics.push(diagnostic("VEL5038", `Look hook '@${expression.name}' is only valid inside a Look condition`, expression.span));
      return boolType;
    }
    if (expression.kind === "UnitLiteralExpression") {
      if (["px", "rem", "em", "vw", "vh", "vmin", "vmax", "fr"].includes(expression.unit)) return { kind: "named", name: "Length" };
      if (expression.unit === "%") return { kind: "named", name: "Percentage" };
      if (["ms", "s"].includes(expression.unit)) return { kind: "named", name: "Duration" };
      if (["deg", "turn"].includes(expression.unit)) return { kind: "named", name: "Angle" };
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
    return super.inferExpression(expression, contextualType);
  }

  private reactiveReference(expression: Expression): { readonly name: string; readonly type: ValueType } | null {
    if (expression.kind === "IdentifierExpression") {
      if (!this.componentStates?.has(expression.name) && this.reactiveBindings.get(expression.name) !== "state") return null;
      return { name: expression.name, type: this.lookup(expression.name)?.type ?? unknownType };
    }
    if (expression.kind === "MemberExpression") {
      const parent = this.reactiveReference(expression.object);
      if (!parent) return null;
      const owner = nonOptional(this.expandAliases(parent.type));
      return { name: parent.name, type: this.semanticMembersOf(owner).get(expression.property) ?? unknownType };
    }
    if (expression.kind === "IndexExpression") {
      const parent = this.reactiveReference(expression.object);
      if (!parent) return null;
      const owner = nonOptional(this.expandAliases(parent.type));
      const type = owner.kind === "list" ? owner.element : owner.kind === "map" ? owner.value : unknownType;
      return { name: parent.name, type };
    }
    return null;
  }

  private mutableReactiveReference(type: ValueType): boolean {
    const value = nonOptional(this.expandAliases(type));
    return value.kind === "list" || value.kind === "set" || value.kind === "map"
      || value.kind === "object" || value.kind === "named" || value.kind === "class"
      || value.kind === "any" || value.kind === "unknown";
  }

  private mutableReactiveReferences(expression: Expression): readonly { readonly name: string; readonly type: ValueType }[] {
    const direct = this.reactiveReference(expression);
    if (direct) return this.mutableReactiveReference(direct.type) ? [direct] : [];
    const nested = (values: readonly Expression[]): readonly { readonly name: string; readonly type: ValueType }[] => {
      const references = values.flatMap((value) => this.mutableReactiveReferences(value));
      return references.filter((reference, index) => references.findIndex((candidate) => candidate.name === reference.name) === index);
    };
    switch (expression.kind) {
      case "ListExpression":
        return nested(expression.elements.map((item) => item.kind === "SpreadExpression" ? item.value : item));
      case "ObjectExpression":
        return nested(expression.properties.map((property) => property.value));
      case "SpreadExpression":
        return this.mutableReactiveReferences(expression.value);
      case "ConditionalExpression":
        return nested([expression.thenValue, expression.elseValue]);
      case "BinaryExpression":
        return expression.operator === "??" ? nested([expression.left, expression.right]) : [];
      case "ArrowFunctionExpression":
        return this.mutableReactiveReferences(expression.body);
      default:
        return [];
    }
  }

  private safeReactiveCopyCall(expression: Extract<Expression, { kind: "CallExpression" }>): boolean {
    if (expression.callee.kind === "IdentifierExpression" && expression.arguments.length <= 1
      && (expression.callee.name === "Map" || expression.callee.name === "Set")) return true;
    return false;
  }

  protected override extensionFieldsOf(name: string): ReadonlyMap<string, ValueType> | null {
    return webTypeFields(name);
  }

  protected override invalidExtensionAwaitContext(): boolean {
    return this.synchronousReactiveDepth > 0 || this.jsxDepth > 0
      || (this.componentStates !== null && this.mountedDepth === 0);
  }

  protected override invalidExtensionAwaitMessage(): string | null {
    if (this.jsxDepth > 0) return "JSX rendering is synchronous; load async component data with a resource or await before constructing JSX";
    if (this.synchronousReactiveDepth > 0) return "Computed expressions and watch blocks are synchronous; use resource, action, or mounted for async work";
    return "Component setup and cleanup are synchronous; use resource, action, or mounted for async work";
  }

  private componentType(statement: ComponentDeclaration): ValueType {
    const props = new Map(statement.parameters.map((parameter) => [parameter.name, this.resolveValidatedAnnotation(parameter.type)]));
    if (!props.has("class")) props.set("class", optionalOf(stringType));
    if (!props.has("look")) props.set("look", optionalOf({ kind: "named", name: "Look" }));
    return {
      kind: "componentConstructor",
      name: statement.name,
      props,
      requiredProps: new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
    };
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
    const declaredResult = this.resolvedAsyncResult(this.resolveValidatedResult(statement.returnType));
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
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "StateDeclaration").map((item) => item.name));
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      const valid = parameter.type ? this.validateTypeReference(parameter.type) : true;
      if (parameter.defaultValue && valid) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      this.declareBinding(parameter.name, false, valid ? type : this.resolveValidatedAnnotation(parameter.type), parameter.span);
    }
    this.constructorDepth = 0;
    let renders = 0;
    let renderValue: Expression | null = null;
    let mounted = 0;
    let cleanup = 0;
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration" || item.kind === "ComputedDeclaration") {
        const annotationValid = item.type ? this.validateTypeReference(item.type) : true;
        const annotationContext = item.type ? this.resolveValidatedAnnotation(item.type) : null;
        if (item.kind === "ComputedDeclaration") {
          this.flowFrameDepth += 1;
          this.synchronousReactiveDepth += 1;
        }
        const actual = this.inferExpression(item.initializer, annotationContext ?? unknownType);
        if (item.kind === "ComputedDeclaration") {
          this.synchronousReactiveDepth -= 1;
          this.flowFrameDepth -= 1;
        }
        const declared = annotationContext ?? actual;
        if (annotationValid) this.requireAssignable(actual, declared, item.initializer.span);
        this.declareBinding(item.name, item.kind === "StateDeclaration", declared, item.span);
      } else if (item.kind === "ResourceDeclaration") {
        this.flowFrameDepth += 1;
        this.analyzeResourceDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ActionDeclaration") {
        this.analyzeActionDeclaration(item);
      } else if (item.kind === "WatchDeclaration") {
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
      } else if (item.kind === "MountedBlock") {
        mounted += 1;
        this.mountedDepth += 1;
        this.flowFrameDepth += 1;
        this.analyzeBlock(item.body);
        this.flowFrameDepth -= 1;
        this.mountedDepth -= 1;
      } else if (item.kind === "CleanupBlock") {
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
        if (rendered.kind !== "node" && rendered.kind !== "any") this.typeError("A component must return JSX", item.span);
      } else {
        this.analyzeStatement(item);
      }
    }
    if (renders !== 1) this.diagnostics.push(diagnostic("VEL5008", `Component '${statement.name}' must have exactly one top-level return`, statement.span));
    if (mounted > 1) this.diagnostics.push(diagnostic("VEL5009", `Component '${statement.name}' has more than one mounted block`, statement.span));
    if (cleanup > 1) this.diagnostics.push(diagnostic("VEL5010", `Component '${statement.name}' has more than one cleanup block`, statement.span));
    if (renderValue?.kind === "JSXElementExpression") this.validateComponentHost(renderValue, statement);
    this.componentStates = previousStates;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.constructorDepth = outerConstructorDepth;
  }

  private validateComponentHost(render: JSXElementExpression, component: ComponentDeclaration): void {
    const hosts: JSXAttribute[] = [];
    const visit = (element: JSXElementExpression): void => {
      if (!/^[A-Z]/u.test(element.tag)) {
        for (const attribute of element.attributes) if (attribute.name === "host") hosts.push(attribute);
      }
      for (const child of element.children) if (child.kind === "JSXElementExpression") visit(child);
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
    entries: Extract<Expression, { kind: "LookExpression" }>["entries"],
    insideTarget: boolean,
    nested: boolean,
    inheritedTerms: number,
  ): void {
    const seenProperties = new Set<string>();
    const seenTargets = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === "LookSpread") {
        const type = this.inferExpression(entry.value, { kind: "named", name: "Look" });
        this.requireAssignable(type, { kind: "named", name: "Look" }, entry.value.span);
        if (nested) this.diagnostics.push(diagnostic("VEL5044", "Look composition is only valid at the outer level; compose first, then place the result in a condition or target", entry.span));
        continue;
      }
      if (entry.kind === "LookIf") {
        this.inferLookCondition(entry.condition);
        const thenTerms = lookConditionTermCount(entry.condition);
        const elseTerms = lookConditionTermCount(entry.condition, true);
        if (inheritedTerms * Math.max(thenTerms, elseTerms) > LOOK_CONDITION_TERM_LIMIT) {
          this.diagnostics.push(diagnostic("VEL5045", `A Look condition may expand to at most ${LOOK_CONDITION_TERM_LIMIT} selector/runtime terms; split this visual decision into ordinary values`, entry.condition.span));
        }
        this.analyzeLookEntries(entry.thenEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * thenTerms));
        this.analyzeLookEntries(entry.elseEntries, insideTarget, true, Math.min(LOOK_CONDITION_TERM_LIMIT, inheritedTerms * elseTerms));
        continue;
      }
      if (entry.kind === "LookTarget") {
        if (!LOOK_TARGETS.has(entry.name)) this.diagnostics.push(diagnostic("VEL5038", `Unknown Look target '@${entry.name}'`, entry.span));
        if (insideTarget) this.diagnostics.push(diagnostic("VEL5038", "Look targets cannot be nested", entry.span));
        if (seenTargets.has(entry.name)) this.diagnostics.push(diagnostic("VEL5039", `Look target '@${entry.name}' is defined more than once in the same scope`, entry.span));
        seenTargets.add(entry.name);
        this.analyzeLookEntries(entry.entries, true, true, inheritedTerms);
        continue;
      }
      if (!LOOK_PROPERTIES.has(entry.name)) this.diagnostics.push(diagnostic("VEL5038", `Unknown Look property '${entry.name}'`, entry.span));
      if (seenProperties.has(entry.name)) this.diagnostics.push(diagnostic("VEL5039", `Look property '${entry.name}' is defined more than once in the same scope`, entry.span));
      seenProperties.add(entry.name);
      const expected = LOOK_PROPERTY_TYPES.get(entry.name) ?? stringType;
      const actual = this.inferExpression(entry.value, expected);
      if (actual.kind !== "null" && expected.kind !== "unknown") this.requireAssignable(actual, expected, entry.value.span);
    }
  }

  private inferLookCondition(expression: Expression): ValueType {
    if (expression.kind === "LookHookExpression") {
      if (!LOOK_HOOKS.has(expression.name)) this.diagnostics.push(diagnostic("VEL5038", `Unknown Look hook '@${expression.name}'`, expression.span));
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
    if (isViewportCondition(expression)) return boolType;
    const type = this.inferExpression(expression);
    this.requireCondition(type, expression);
    return boolType;
  }

  private inferJsx(expression: JSXElementExpression): ValueType {
    this.jsxDepth += 1;
    const attributes = new Map(expression.attributes.map((attribute) => [attribute.name, attribute]));
    const component = /^[A-Z]/u.test(expression.tag);
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
    for (const child of expression.children) {
      if (child.kind === "JSXExpressionChild") {
        const childType = this.inferExpression(child.expression);
        if (containsPromise(this.expandAliases(childType))) this.diagnostics.push(diagnostic("VEL5031", "JSX cannot render a Promise; await it before rendering", child.expression.span));
        else if (!isInvalidType(childType) && !(child.expression.kind === "ListExpression" && child.expression.elements.length === 0)
          && !this.isJsxRenderable(childType)) {
          this.diagnostics.push(diagnostic("VEL5047", `JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values; received ${describeType(childType)}`, child.expression.span));
        }
        const list = jsxMapExpression(child.expression);
        if (list && !list.body.attributes.some((attribute) => attribute.name === "key")) this.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", list.body.span));
      } else if (child.kind === "JSXElementExpression") {
        this.inferJsx(child);
      }
    }
    this.jsxDepth -= 1;
    return { kind: "node" };
  }

  private analyzeComponentElement(expression: JSXElementExpression): void {
    const binding = this.lookup(expression.tag);
    if (!binding || binding.type.kind !== "componentConstructor") {
      this.diagnostics.push(diagnostic("VEL5011", `Unknown component '${expression.tag}'`, expression.span));
      return;
    }
    const provided = new Set(expression.attributes.filter((attribute) => attribute.name !== "key" && !removedJsxControlAttributes.has(attribute.name)).map((attribute) => attribute.name));
    const hasChildren = expression.children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
    if (hasChildren && provided.has("children")) this.diagnostics.push(diagnostic("VEL5014", `Component '${expression.tag}' receives children both as a prop and as JSX content`, expression.span));
    else if (hasChildren && !binding.type.props.has("children")) this.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children`, expression.span));
    else if (hasChildren) {
      provided.add("children");
      this.requireAssignable({ kind: "node" }, binding.type.props.get("children")!, expression.span);
    }
    for (const required of binding.type.requiredProps) if (!provided.has(required)) this.diagnostics.push(diagnostic("VEL5012", `Component '${expression.tag}' requires prop '${required}'`, expression.span));
    for (const attribute of expression.attributes) {
      if (removedJsxControlAttributes.has(attribute.name)) continue;
      if (attribute.name === "key") {
        const key = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (!isInvalidType(key) && key.kind !== "string" && key.kind !== "number" && key.kind !== "enum" && key.kind !== "any") this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
        continue;
      }
      if (attribute.value && typeof attribute.value !== "string") {
        for (const reactive of this.mutableReactiveReferences(attribute.value)) {
          this.diagnostics.push(diagnostic(
            "VEL5046",
            `Reactive state '${reactive.name}' cannot cross a component prop by mutable reference; pass a derived value or an explicit copy`,
            attribute.value.span,
          ));
        }
      }
      const expected = binding.type.props.get(attribute.name);
      if (attribute.name === "look") {
        const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (!this.isLookInput(actual)) this.diagnostics.push(diagnostic("VEL5040", `JSX look requires Look, Look?, or a list of Look values; received ${describeType(actual)}`, attribute.span));
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
      this.semanticJsxAttributeOwners.set(`${attribute.span.start}:${attribute.name}`, { ...binding.type, name: expression.tag });
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
      if (binding.type.intrinsic === "web.router" && attribute.name === "fallback" && actual.kind !== "null" && actual.kind !== "any") {
        this.checkWebRouteComponent(actual, attribute.span, "A Router fallback");
      }
      this.requireAssignable(actual, expected, attribute.span);
    }
  }

  private analyzeNativeJsxAttribute(expression: JSXElementExpression, attribute: JSXAttribute): void {
    const value = attribute.value;
    const eventName = attribute.name.startsWith("on:") ? attribute.name.slice(3).split(".")[0] ?? "" : "";
    const expectedEvent = eventName ? webEventType(eventName) : null;
    const eventHandlerType: ValueType | null = expectedEvent ? { kind: "function", parameters: [expectedEvent], requiredParameters: 1, result: unknownType } : null;
    const inferred = typeof value === "string" ? stringType : value ? this.inferExpression(value, eventHandlerType ?? unknownType) : boolType;
    if (attribute.name === "style" || attribute.name.startsWith("style:")) {
      this.diagnostics.push(diagnostic("VEL5041", "Controlled VelarScript components do not expose inline style; use a Look or an unsafe CSS import", attribute.span));
    } else if (attribute.name === "look") {
      if (!value || typeof value === "string") this.diagnostics.push(diagnostic("VEL5040", "JSX look requires an expression value", attribute.span));
      else if (!this.isLookInput(inferred)) this.diagnostics.push(diagnostic("VEL5040", `JSX look requires Look, Look?, or a list of Look values; received ${describeType(inferred)}`, attribute.span));
    } else if (attribute.name === "class") {
      if (!this.isClassInput(inferred)) this.diagnostics.push(diagnostic("VEL5040", `JSX class requires string, string?, or a list of strings; received ${describeType(inferred)}`, attribute.span));
    } else if (attribute.name === "unsafe:html") {
      if (!isInvalidType(inferred) && inferred.kind !== "any" && !this.isOptionalString(inferred)) {
        this.diagnostics.push(diagnostic("VEL5047", `unsafe:html requires string or string?, received ${describeType(inferred)}`, attribute.span));
      }
    } else if (attribute.name === "bind:value") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || (!this.componentStates?.has(value.name) && this.reactiveBindings.get(value.name) !== "state")) {
        this.diagnostics.push(diagnostic("VEL5019", "bind:value requires a writable state name", attribute.span));
      } else {
        if (!["input", "textarea", "select"].includes(expression.tag)) this.diagnostics.push(diagnostic("VEL5019", `bind:value is not valid on <${expression.tag}>`, attribute.span));
        const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
        this.requireAssignable(inferred, numeric ? numberType : stringType, attribute.span);
        if (!numeric && inferred.kind === "enum") this.enumValueBindings.set(attribute.span.start, inferred.name);
      }
    } else if (attribute.name === "bind:checked") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || (!this.componentStates?.has(value.name) && this.reactiveBindings.get(value.name) !== "state")) {
        this.diagnostics.push(diagnostic("VEL5019", "bind:checked requires a writable state name", attribute.span));
      } else {
        if (expression.tag !== "input") this.diagnostics.push(diagnostic("VEL5019", `bind:checked is not valid on <${expression.tag}>`, attribute.span));
        this.requireAssignable(inferred, boolType, attribute.span);
      }
    } else if (attribute.name === "ref") {
      if (!value || typeof value === "string" || value.kind !== "IdentifierExpression" || !this.lookup(value.name)?.mutable) {
        this.diagnostics.push(diagnostic("VEL5020", "ref requires a mutable let binding", attribute.span));
      } else {
        const bindingType = this.lookup(value.name)!.type;
        const target = nonOptional(bindingType);
        const expected = expression.tag === "canvas" ? "CanvasElement" : expression.tag === "dialog" ? "DialogElement" : ["input", "select", "textarea"].includes(expression.tag) ? "InputElement" : "Element";
        if (bindingType.kind !== "any" && bindingType.kind !== "optional") this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element? so cleanup can restore null`, attribute.span));
        else if (target.kind !== "any" && (target.kind !== "named" || (target.name !== expected && target.name !== "Element"))) this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element?`, attribute.span));
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
      }
    } else if (attribute.name.startsWith("class:")) {
      this.requireAssignable(inferred, boolType, attribute.span);
    } else if (attribute.name === "key" && !isInvalidType(inferred) && inferred.kind !== "string" && inferred.kind !== "number" && inferred.kind !== "enum" && inferred.kind !== "any") {
      this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
    } else if (!isInvalidType(inferred) && !this.isJsxAttributeValue(inferred)) {
      this.diagnostics.push(diagnostic("VEL5047", `Native JSX attributes require text, finite numbers, bool, enums, or null; received ${describeType(inferred)}`, attribute.span));
    }
    if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
      && !expression.attributes.some((item) => item.name === "role")) this.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
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
      || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "node") return true;
    if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
    if (expanded.kind === "optional") return this.isJsxRenderable(expanded.inner);
    if (expanded.kind === "list") return this.isJsxRenderable(expanded.element);
    if (expanded.kind === "union") return expanded.members.every((member) => this.isJsxRenderable(member));
    return false;
  }

  private isJsxAttributeValue(type: ValueType): boolean {
    const expanded = this.expandAliases(type);
    if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
      || expanded.kind === "bool" || expanded.kind === "enum") return true;
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
    if (type.kind !== "componentConstructor") {
      if (type.kind !== "any") this.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
      return;
    }
    const unsupported = [...type.requiredProps].filter((name) => name !== "route");
    if (unsupported.length > 0) this.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
    const routeProp = type.props.get("route");
    if (routeProp && !isAssignable({ kind: "named", name: "RouteContext" }, routeProp, this)) this.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
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
  if (name === "Blob") return new Map();
  if (name === "File") return new Map([["name", stringType], ["size", numberType], ["type", stringType], ["modified", numberType]]);
  if (name === "Element" || name === "InputElement" || name === "CanvasElement" || name === "DialogElement") {
    const fields = new Map<string, ValueType>([["focus", functionType([], [], nullType)], ["remove", functionType([], [], nullType)]]);
    if (name === "InputElement") { fields.set("value", stringType); fields.set("checked", boolType); }
    if (name === "CanvasElement") { fields.set("width", numberType); fields.set("height", numberType); fields.set("getContext", functionType(["kind"], [stringType], unknownType)); }
    return fields;
  }
  return null;
}

function webEventType(name: string): ValueType {
  if (name === "keydown" || name === "keyup" || name === "keypress") return { kind: "named", name: "KeyboardEvent" };
  if (["click", "pointerdown", "pointerup", "pointermove", "pointercancel", "pointerover", "pointerout", "pointerenter", "pointerleave"].includes(name)) return { kind: "named", name: "PointerEvent" };
  if (name === "beforeinput" || name === "input") return { kind: "named", name: "InputEvent" };
  return { kind: "named", name: "Event" };
}
