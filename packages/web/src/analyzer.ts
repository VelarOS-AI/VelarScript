import type { Diagnostic, Span } from "@velarscript/compiler";
import {
  Analyzer,
  anyType,
  boolType,
  describeType,
  isAssignable,
  noneType,
  nonOptional,
  numberType,
  optionalOf,
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

type ComponentDeclaration = Extract<Statement, { kind: "ComponentDeclaration" }>;
type ActionDeclaration = Extract<Statement, { kind: "ActionDeclaration" }>;
type ResourceDeclaration = Extract<Statement, { kind: "ResourceDeclaration" }>;
type JSXElementExpression = Extract<Expression, { kind: "JSXElementExpression" }>;
type JSXAttribute = JSXElementExpression["attributes"][number];

const jsxControlAttributes = new Set(["if", "else-if", "else"]);
const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });

export function inferWebIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, arguments: arguments_, callSpan, arity, inferAt, callbackAt, runtimeTypeAt } = context;
  switch (intrinsic.name) {
    case "web.route": {
      arity(2, 2);
      inferAt(0, stringType);
      const component = inferAt(1);
      const path = arguments_[0];
      if (path?.kind === "LiteralExpression" && typeof path.value === "string") checkRoutePath(path.value, path.span, context);
      checkRouteComponent(component, arguments_[1]?.span ?? callSpan, "A route", context);
      return { kind: "object", fields: new Map([["path", stringType], ["component", anyType]]) };
    }
    case "web.lazy": {
      arity(2, 4);
      const loader = inferAt(0);
      inferAt(1, stringType);
      const loadingFallback = inferAt(2);
      const failedFallback = inferAt(3);
      const loaderExpression = arguments_[0];
      if (loaderExpression?.kind !== "ArrowFunctionExpression" || loaderExpression.parameters.length !== 0 || loaderExpression.body.kind !== "DynamicImportExpression") {
        context.typeError("A lazy loader must be written as () => import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      if (loader.kind !== "function" && loader.kind !== "any") {
        if (arguments_[0]) context.typeError(`Expected a module loader, received ${describeType(loader)}`, arguments_[0]!.span);
        return anyType;
      }
      if (loader.kind === "any") return anyType;
      if (loader.parameters.length !== 0) context.typeError("A lazy module loader cannot receive parameters", arguments_[0]?.span ?? callSpan);
      const moduleType = loader.result.kind === "promise" ? loader.result.value : null;
      if (!moduleType) {
        context.typeError("A lazy module loader must return import(\"./module.vel\")", arguments_[0]?.span ?? callSpan);
        return anyType;
      }
      const name = arguments_[1]?.kind === "LiteralExpression" && typeof arguments_[1].value === "string" ? arguments_[1].value : null;
      if (!name) {
        context.typeError("A lazy component export name must be a string literal", arguments_[1]?.span ?? callSpan);
        return anyType;
      }
      if (moduleType.kind !== "object") {
        context.typeError("A lazy loader must load a checked Velar module", arguments_[0]?.span ?? callSpan);
        return anyType;
      }
      const exported = moduleType.fields.get(name);
      if (!exported) {
        context.typeError(`Dynamically imported module has no export named '${name}'`, arguments_[1]?.span ?? callSpan);
        return anyType;
      }
      if (exported.kind !== "componentConstructor") {
        context.typeError(`Dynamic export '${name}' is ${describeType(exported)}, not a component`, arguments_[1]?.span ?? callSpan);
        return anyType;
      }
      if (arguments_[2] && loadingFallback.kind !== "none" && loadingFallback.kind !== "any") {
        if (loadingFallback.kind !== "componentConstructor") context.typeError("A lazy loading fallback must be a component", arguments_[2]!.span);
        else if (loadingFallback.requiredProps.size > 0) context.typeError("A lazy loading fallback cannot require props", arguments_[2]!.span);
      }
      if (arguments_[3] && failedFallback.kind !== "none" && failedFallback.kind !== "any") {
        if (failedFallback.kind !== "componentConstructor") context.typeError("A lazy failure fallback must be a component accepting error: Error", arguments_[3]!.span);
        else {
          const error = failedFallback.props.get("error");
          if (!error || !context.isAssignable({ kind: "class", name: "Error" }, error) || [...failedFallback.requiredProps].some((prop) => prop !== "error")) {
            context.typeError("A lazy failure fallback must accept error: Error and require no other props", arguments_[3]!.span);
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
        if (index === intrinsic.parameters.length - 1 && arguments_[index]) options = actual;
      }
      const fields = options?.kind === "object" ? options.fields : null;
      const body = fields?.get("body");
      if (body && !context.isHttpFormBody(body) && context.jsonSerializable(body) === false) {
        const optionsExpression = arguments_[intrinsic.parameters.length - 1];
        const bodyExpression = optionsExpression?.kind === "ObjectExpression"
          ? optionsExpression.properties.find((property) => property.kind === "ObjectProperty" && property.name === "body")?.value
          : null;
        context.typeError(`HTTP JSON bodies accept only records, Lists, enums, primitives, and optionals; received ${describeType(body)}`, bodyExpression?.span ?? optionsExpression?.span ?? callSpan);
      }
      return intrinsic.result;
    }
    case "realtime.sendJson": {
      arity(1, 1);
      const value = inferAt(0);
      if (context.jsonSerializable(value) === false && arguments_[0]) context.typeError(`Realtime JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, arguments_[0]!.span);
      return noneType;
    }
    case "config.public":
      arity(1, 1);
      return runtimeTypeAt(0);
    case "storage.get": {
      arity(2, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (arguments_[2]) { inferAt(2, parsed); return parsed; }
      return optionalOf(parsed);
    }
    case "storage.databaseGet": {
      arity(2, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      if (arguments_[2]) { inferAt(2, parsed); return { kind: "promise", value: parsed }; }
      return { kind: "promise", value: optionalOf(parsed) };
    }
    case "storage.watch": {
      arity(3, 3);
      inferAt(0, stringType);
      const parsed = runtimeTypeAt(1);
      callbackAt(2, [optionalOf(parsed), optionalOf(parsed)], unknownType);
      return { kind: "function", parameters: [], requiredParameters: 0, result: noneType };
    }
    case "forms.read": {
      arity(2, 2);
      inferAt(0, { kind: "named", name: "Element" });
      const parsed = runtimeTypeAt(1);
      if (parsed.kind === "any" || parsed.kind === "unknown") return parsed;
      const expanded = context.expandAliases(parsed);
      const fields = expanded.kind === "named" ? context.declaredFieldsOf(expanded.name) : null;
      if (!fields) {
        context.typeError("Form reading requires a record declared with 'type Name:'", arguments_[1]?.span ?? callSpan);
        return parsed;
      }
      const descriptors: FormReadField[] = [];
      for (const [name, field] of fields) {
        const descriptor = context.formReadField(name, field, arguments_[1]?.span ?? callSpan);
        if (descriptor) descriptors.push(descriptor);
      }
      if (descriptors.length === fields.size) context.recordFormRead(callSpan.start, descriptors);
      return parsed;
    }
    default:
      return undefined;
  }
}

function checkRouteComponent(type: ValueType, sourceSpan: Span, subject: string, context: CompilerIntrinsicAnalysisContext): void {
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

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
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
        const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
        if (statement.kind === "ComputedDeclaration") this.flowFrameDepth += 1;
        const actual = this.inferExpression(statement.initializer, annotated ?? unknownType);
        if (statement.kind === "ComputedDeclaration") this.flowFrameDepth -= 1;
        const declared = annotated ?? actual;
        if (statement.type) this.validateType(declared, statement.type.span);
        this.requireAssignable(actual, declared, statement.initializer.span);
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
        {
          const watched = this.inferExpression(statement.expression);
          this.enterScope();
          if (statement.currentName) this.declareBinding(statement.currentName, false, watched, statement.span);
          if (statement.previousName) this.declareBinding(statement.previousName, false, watched, statement.span);
          for (const child of statement.body) this.analyzeStatement(child);
          this.exitScope();
        }
        this.flowFrameDepth -= 1;
        return true;
      default:
        return false;
    }
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    return expression.kind === "JSXElementExpression" ? this.inferJsx(expression) : undefined;
  }

  protected override extensionFieldsOf(name: string): ReadonlyMap<string, ValueType> | null {
    return webTypeFields(name);
  }

  protected override invalidExtensionAwaitContext(): boolean {
    return this.componentStates !== null && this.mountedDepth === 0;
  }

  private componentType(statement: ComponentDeclaration): ValueType {
    return {
      kind: "componentConstructor",
      name: statement.name,
      props: new Map(statement.parameters.map((parameter) => [parameter.name, this.resolveAnnotation(parameter.type)])),
      requiredProps: new Set(statement.parameters.filter((parameter) => !parameter.defaultValue).map((parameter) => parameter.name)),
    };
  }

  private analyzeResourceDeclaration(statement: ResourceDeclaration): void {
    const annotated = statement.type ? this.resolveAnnotation(statement.type) : null;
    if (statement.type) this.validateType(annotated!, statement.type.span);
    const expected: ValueType = annotated ? { kind: "promise", value: annotated } : unknownType;
    const actual = this.inferExpression(statement.initializer, expected);
    let value = annotated ?? unknownType;
    if (actual.kind === "promise") {
      if (annotated) this.requireAssignable(actual.value, annotated, statement.initializer.span);
      else value = actual.value;
    } else if (actual.kind === "any") {
      value = annotated ?? anyType;
    } else {
      this.diagnostics.push(diagnostic("VEL4016", `A resource initializer must return Promise<T>, received ${describeType(actual)}`, statement.initializer.span));
    }
    const fields = new Map<string, ValueType>([
      ["value", value.kind === "none" ? noneType : optionalOf(value)],
      ["loading", boolType],
      ["ready", boolType],
      ["error", optionalOf({ kind: "class", name: "Error" })],
      ["reload", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: noneType } }],
    ]);
    this.declareBinding(statement.name, false, { kind: "object", fields }, statement.span);
  }

  private actionType(statement: ActionDeclaration): ValueType {
    const declaredResult = this.resolvedAsyncResult(this.resolveResult(statement.returnType));
    const callValue = declaredResult.kind === "none" ? noneType : optionalOf(declaredResult);
    const rest = statement.parameters.find((parameter) => parameter.rest);
    return {
      kind: "action",
      parameters: statement.parameters.filter((parameter) => !parameter.rest).map((parameter) => this.resolveAnnotation(parameter.type)),
      requiredParameters: statement.parameters.filter((parameter) => !parameter.rest && !parameter.defaultValue).length,
      ...(rest ? { rest: this.resolveAnnotation(rest.type) } : {}),
      result: { kind: "promise", value: callValue },
    };
  }

  private analyzeActionDeclaration(statement: ActionDeclaration): void {
    this.declareBinding(statement.name, false, this.actionType(statement), statement.span);
    this.analyzeFunctionDeclaration(statement, null, true, false, true, "Action");
  }

  private analyzeComponent(statement: ComponentDeclaration): void {
    const outerClassInitDepth = this.classInitDepth;
    if (!this.isPredeclared(statement)) this.declareBinding(statement.name, false, this.componentType(statement), statement.span);
    this.enterScope();
    this.flowFrameDepth += 1;
    const previousStates = this.componentStates;
    this.componentStates = new Set(statement.body.filter((item) => item.kind === "StateDeclaration").map((item) => item.name));
    for (const parameter of statement.parameters) {
      const type = this.resolveAnnotation(parameter.type);
      if (parameter.type) this.validateType(type, parameter.type.span);
      if (parameter.defaultValue) this.requireAssignable(this.inferParameterDefault(parameter.defaultValue, type), type, parameter.defaultValue.span);
      this.declareBinding(parameter.name, false, type, parameter.span);
    }
    this.classInitDepth = 0;
    let renders = 0;
    let mounted = 0;
    let cleanup = 0;
    for (const item of statement.body) {
      if (item.kind === "StateDeclaration" || item.kind === "ComputedDeclaration") {
        const annotated = item.type ? this.resolveAnnotation(item.type) : null;
        if (item.kind === "ComputedDeclaration") this.flowFrameDepth += 1;
        const actual = this.inferExpression(item.initializer, annotated ?? unknownType);
        if (item.kind === "ComputedDeclaration") this.flowFrameDepth -= 1;
        const declared = annotated ?? actual;
        if (item.type) this.validateType(declared, item.type.span);
        this.requireAssignable(actual, declared, item.initializer.span);
        this.declareBinding(item.name, item.kind === "StateDeclaration", declared, item.span);
      } else if (item.kind === "ResourceDeclaration") {
        this.flowFrameDepth += 1;
        this.analyzeResourceDeclaration(item);
        this.flowFrameDepth -= 1;
      } else if (item.kind === "ActionDeclaration") {
        this.analyzeActionDeclaration(item);
      } else if (item.kind === "WatchDeclaration") {
        this.flowFrameDepth += 1;
        const watched = this.inferExpression(item.expression);
        this.enterScope();
        if (item.currentName) this.declareBinding(item.currentName, false, watched, item.span);
        if (item.previousName) this.declareBinding(item.previousName, false, watched, item.span);
        for (const child of item.body) this.analyzeStatement(child);
        this.exitScope();
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
      } else if (item.kind === "StyleBlock") {
        // CSS analysis is owned by the Web style pass.
      } else if (item.kind === "ReturnStatement") {
        renders += 1;
        this.flowFrameDepth += 1;
        const rendered = item.value ? this.inferExpression(item.value) : noneType;
        this.flowFrameDepth -= 1;
        if (rendered.kind !== "node" && rendered.kind !== "any") this.typeError("A component must return JSX", item.span);
      } else {
        this.analyzeStatement(item);
      }
    }
    if (renders !== 1) this.diagnostics.push(diagnostic("VEL5008", `Component '${statement.name}' must have exactly one top-level return`, statement.span));
    if (mounted > 1) this.diagnostics.push(diagnostic("VEL5009", `Component '${statement.name}' has more than one mounted block`, statement.span));
    if (cleanup > 1) this.diagnostics.push(diagnostic("VEL5010", `Component '${statement.name}' has more than one cleanup block`, statement.span));
    this.componentStates = previousStates;
    this.flowFrameDepth -= 1;
    this.exitScope();
    this.classInitDepth = outerClassInitDepth;
  }

  private inferJsx(expression: JSXElementExpression, controlHandled = false): ValueType {
    const attributes = new Map(expression.attributes.map((attribute) => [attribute.name, attribute]));
    const controls = expression.attributes.filter((attribute) => jsxControlAttributes.has(attribute.name));
    if (attributes.size !== expression.attributes.length) this.diagnostics.push(diagnostic("VEL5014", `JSX element '${expression.tag}' has duplicate attributes`, expression.span));
    if (controls.length > 1) this.diagnostics.push(diagnostic("VEL5029", "A JSX branch can have only one of 'if', 'else-if', or 'else'", expression.span));
    if (!controlHandled && controls.length > 0) this.diagnostics.push(diagnostic("VEL5029", `JSX '${controls[0]!.name}' must be part of an adjacent child branch sequence`, controls[0]!.span));
    if (expression.tag && !/^[A-Z]/u.test(expression.tag)) {
      for (const attribute of expression.attributes) if (!jsxControlAttributes.has(attribute.name)) this.analyzeNativeJsxAttribute(expression, attribute);
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
    for (let index = 0; index < expression.children.length;) {
      const child = expression.children[index]!;
      if (child.kind === "JSXExpressionChild") {
        const childType = this.inferExpression(child.expression);
        if (containsPromise(this.expandAliases(childType))) this.diagnostics.push(diagnostic("VEL5031", "JSX cannot render a Promise; await it before rendering", child.expression.span));
        const list = jsxMapExpression(child.expression);
        if (list && !list.body.attributes.some((attribute) => attribute.name === "key")) this.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", list.body.span));
        index += 1;
      } else if (child.kind === "JSXText") {
        index += 1;
      } else {
        const control = child.attributes.find((attribute) => jsxControlAttributes.has(attribute.name));
        if (control?.name === "if") {
          let rejected = this.inferJsxConditionalBranch(child, control);
          let cursor = index + 1;
          let sawElse = false;
          while (cursor < expression.children.length) {
            const next = expression.children[cursor]!;
            if (next.kind === "JSXText" && next.value.trim().length === 0) { cursor += 1; continue; }
            if (next.kind !== "JSXElementExpression") break;
            const nextControl = next.attributes.find((attribute) => jsxControlAttributes.has(attribute.name));
            if (!nextControl || (nextControl.name !== "else-if" && nextControl.name !== "else") || sawElse) break;
            rejected = this.inferJsxConditionalBranch(next, nextControl, rejected);
            sawElse = nextControl.name === "else";
            cursor += 1;
          }
          index = cursor;
        } else if (control) {
          this.diagnostics.push(diagnostic("VEL5029", `JSX '${control.name}' requires an adjacent preceding 'if' branch`, control.span));
          this.inferJsxConditionalBranch(child, control);
          index += 1;
        } else {
          this.inferJsx(child);
          index += 1;
        }
      }
    }
    if (/^[A-Z]/u.test(expression.tag)) this.analyzeComponentElement(expression);
    return { kind: "node" };
  }

  private analyzeComponentElement(expression: JSXElementExpression): void {
    const binding = this.lookup(expression.tag);
    if (!binding || binding.type.kind !== "componentConstructor") {
      this.diagnostics.push(diagnostic("VEL5011", `Unknown component '${expression.tag}'`, expression.span));
      return;
    }
    const provided = new Set(expression.attributes.filter((attribute) => attribute.name !== "key" && !jsxControlAttributes.has(attribute.name)).map((attribute) => attribute.name));
    const hasChildren = expression.children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
    if (hasChildren && provided.has("children")) this.diagnostics.push(diagnostic("VEL5014", `Component '${expression.tag}' receives children both as a prop and as JSX content`, expression.span));
    else if (hasChildren && !binding.type.props.has("children")) this.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children`, expression.span));
    else if (hasChildren) {
      provided.add("children");
      this.requireAssignable({ kind: "node" }, binding.type.props.get("children")!, expression.span);
    }
    for (const required of binding.type.requiredProps) if (!provided.has(required)) this.diagnostics.push(diagnostic("VEL5012", `Component '${expression.tag}' requires prop '${required}'`, expression.span));
    for (const attribute of expression.attributes) {
      if (jsxControlAttributes.has(attribute.name)) continue;
      if (attribute.name === "key") {
        const key = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
        if (key.kind !== "string" && key.kind !== "number" && key.kind !== "enum" && key.kind !== "any") this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
        continue;
      }
      const expected = binding.type.props.get(attribute.name);
      if (!expected) {
        this.diagnostics.push(diagnostic("VEL5013", `Component '${expression.tag}' has no prop '${attribute.name}'`, attribute.span));
        continue;
      }
      this.semanticJsxAttributeOwners.set(`${attribute.span.start}:${attribute.name}`, { ...binding.type, name: expression.tag });
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? this.inferExpression(attribute.value) : boolType;
      if (binding.type.intrinsic === "web.router" && attribute.name === "fallback" && actual.kind !== "none" && actual.kind !== "any") {
        this.checkWebRouteComponent(actual, attribute.span, "A Router fallback");
      }
      this.requireAssignable(actual, expected, attribute.span);
    }
  }

  private inferJsxConditionalBranch(expression: JSXElementExpression, control: JSXAttribute, inherited: ReadonlyMap<string, ValueType> = new Map()): ReadonlyMap<string, ValueType> {
    this.enterScope();
    this.applyNarrowings(inherited, expression.span);
    if (control.name === "else") {
      if (control.value !== null) this.diagnostics.push(diagnostic("VEL5029", "JSX 'else' does not accept a value", control.span));
      this.inferJsx(expression, true);
      this.exitScope();
      return inherited;
    }
    if (control.value === null || typeof control.value === "string") {
      this.diagnostics.push(diagnostic("VEL5029", `JSX '${control.name}' requires an expression value`, control.span));
      this.inferJsx(expression, true);
      this.exitScope();
      return inherited;
    }
    const condition = this.inferExpression(control.value);
    this.requireCondition(condition, control.value);
    const narrowed = this.narrowingFor(control.value, condition);
    this.enterScope();
    this.applyNarrowings(narrowed, expression.span);
    this.inferJsx(expression, true);
    this.exitScope();
    const rejected = new Map(inherited);
    for (const [key, type] of this.negativeNarrowingFor(control.value)) rejected.set(key, type);
    this.exitScope();
    return rejected;
  }

  private analyzeNativeJsxAttribute(expression: JSXElementExpression, attribute: JSXAttribute): void {
    const value = attribute.value;
    const eventName = attribute.name.startsWith("on:") ? attribute.name.slice(3).split(".")[0] ?? "" : "";
    const expectedEvent = eventName ? webEventType(eventName) : null;
    const eventHandlerType: ValueType | null = expectedEvent ? { kind: "function", parameters: [expectedEvent], requiredParameters: 1, result: unknownType } : null;
    const inferred = typeof value === "string" ? stringType : value ? this.inferExpression(value, eventHandlerType ?? unknownType) : boolType;
    if (attribute.name === "bind:value") {
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
        if (bindingType.kind !== "any" && bindingType.kind !== "optional") this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element? so cleanup can restore none`, attribute.span));
        else if (target.kind !== "any" && (target.kind !== "named" || (target.name !== expected && target.name !== "Element"))) this.diagnostics.push(diagnostic("VEL5024", `A <${expression.tag}> ref requires ${expected}? or Element?`, attribute.span));
      }
    } else if (attribute.name.startsWith("on:")) {
      const [event, ...modifiers] = attribute.name.slice(3).split(".");
      const supported = new Set(["prevent", "stop", "once", "capture", "self"]);
      if (!event) this.diagnostics.push(diagnostic("VEL5025", "An event directive requires an event name", attribute.span));
      for (const modifier of modifiers) if (!supported.has(modifier)) this.diagnostics.push(diagnostic("VEL5025", `Unknown event modifier '${modifier}'`, attribute.span));
      if (new Set(modifiers).size !== modifiers.length) this.diagnostics.push(diagnostic("VEL5025", "Event modifiers cannot be repeated", attribute.span));
      if (inferred.kind !== "function" && inferred.kind !== "action" && inferred.kind !== "intrinsic" && inferred.kind !== "any" && inferred.kind !== "unknown") {
        this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' requires a function`, attribute.span));
      } else if (inferred.kind === "function" || inferred.kind === "action" || inferred.kind === "intrinsic") {
        if (inferred.rest || inferred.parameters.length > 1) this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' handlers accept zero parameters or one ${describeType(expectedEvent ?? { kind: "named", name: "Event" })} parameter`, attribute.span));
        else if (inferred.parameters.length === 1 && expectedEvent && !isAssignable(expectedEvent, inferred.parameters[0]!, this)) this.diagnostics.push(diagnostic("VEL5021", `Event '${event}' provides ${describeType(expectedEvent)}, not ${describeType(inferred.parameters[0]!)}`, attribute.span));
      }
    } else if (attribute.name.startsWith("class:")) {
      this.requireAssignable(inferred, boolType, attribute.span);
    } else if (attribute.name === "key" && inferred.kind !== "string" && inferred.kind !== "number" && inferred.kind !== "enum" && inferred.kind !== "any") {
      this.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
    }
    if (attribute.name.startsWith("on:click") && !["button", "a", "input", "select", "textarea", "summary"].includes(expression.tag)
      && !expression.attributes.some((item) => item.name === "role")) this.diagnostics.push(diagnostic("VEL5023", `Clickable <${expression.tag}> requires an explicit role`, expression.span));
  }

  private checkWebRouteComponent(type: ValueType, sourceSpan: Span, subject: string): void {
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
  const functionType = (parameters: readonly ValueType[], result: ValueType): ValueType => ({ kind: "function", parameters, requiredParameters: parameters.length, result });
  const eventFields = (): Map<string, ValueType> => new Map([
    ["type", stringType], ["defaultPrevented", boolType], ["preventDefault", functionType([], noneType)], ["stopPropagation", functionType([], noneType)],
  ]);
  if (name === "Event") return eventFields();
  if (name === "KeyboardEvent") return new Map([...eventFields(), ["key", stringType], ["code", stringType], ["repeat", boolType], ["altKey", boolType], ["ctrlKey", boolType], ["metaKey", boolType], ["shiftKey", boolType]]);
  if (name === "PointerEvent") return new Map([...eventFields(), ["pointerId", numberType], ["pointerType", stringType], ["pressure", numberType], ["button", numberType], ["buttons", numberType], ["clientX", numberType], ["clientY", numberType], ["movementX", numberType], ["movementY", numberType], ["altKey", boolType], ["ctrlKey", boolType], ["metaKey", boolType], ["shiftKey", boolType]]);
  if (name === "InputEvent") return new Map([...eventFields(), ["data", optionalOf(stringType)], ["inputType", stringType], ["isComposing", boolType]]);
  if (name === "Element" || name === "InputElement" || name === "CanvasElement" || name === "DialogElement") {
    const fields = new Map<string, ValueType>([["focus", functionType([], noneType)], ["remove", functionType([], noneType)]]);
    if (name === "InputElement") { fields.set("value", stringType); fields.set("checked", boolType); }
    if (name === "CanvasElement") { fields.set("width", numberType); fields.set("height", numberType); fields.set("getContext", functionType([stringType], anyType)); }
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
