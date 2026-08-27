import {
  Analyzer,
  bindingNeverReassigned,
  boolType,
  describeType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unknownType,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type CompilerIntrinsicAnalysisContext,
  type Expression,
  type Parameter,
  type Program,
  type Span,
  spanIdentity,
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { routeShape } from "./route-shape.ts";
import {
  collectRoutePatternValues,
  evaluateRoutePatternExpression,
  isCompiledRoutePattern,
  isRoutePatternStaticValue,
  type CompiledRoutePattern,
  type RoutePatternCapture,
  type RoutePatternStaticValue,
} from "./route-pattern.ts";
import { isNodeServerStatement, type NodeNotFoundDeclaration, type NodeResponseDeclaration, type NodeRouteDeclaration, type NodeServerDeclaration, type NodeServerSpread } from "./server-ast.ts";
import {
  isNodeProviderType,
  isNodeRouteInputType,
  isServeRequestType,
  isWebSocketConnectionType,
  nodeBoundRoutePathType,
  nodeProviderResult,
  nodeProviderType,
  nodeRouteInputType,
  nodeRouteInputValue,
  httpOutcomeType,
  routePatternType,
  serveAppType,
  serveRequestType,
  VELAR_HTTP_OUTCOME_IDENTITY,
  type NodeRouteInputType,
} from "./server-types.ts";

const routeHintPrefix = "node.route-param:";
const routeResultHintPrefix = "node.route-result:";
const routeCaptureHintPrefix = "node.route-capture:";
const responseHeadersType: ValueType = {kind: "map", key: stringType, value: stringType};
const sseEventType: ValueType = {kind: "object", fields: new Map([
  ["data", stringType], ["event", optionalOf(stringType)], ["id", optionalOf(stringType)], ["retry", optionalOf(numberType)],
]), optionalFields: new Set(["event", "id", "retry"])};
const sseSendType: ValueType = {kind: "function", parameterNames: ["event"], parameters: [{kind: "union", members: [stringType, sseEventType]}], requiredParameters: 1, result: {kind: "promise", value: nullType}};
/**
 * A route or fallback as this server sees it: written here (`spread` null, empty origin) or composed
 * in by a spread, in which case `origin` names the servers from the spread expression inward to the
 * one that declares it.
 */
type ComposedRoute = {readonly route: NodeRouteDeclaration; readonly path: string; readonly spread: NodeServerSpread | null; readonly origin: readonly string[]};
type ComposedFallback = {readonly fallback: NodeNotFoundDeclaration; readonly spread: NodeServerSpread | null; readonly origin: readonly string[]};
/**
 * A module-level `const name = expression` or never-reassigned `let name = expression` binding
 * whose initializer can still resolve to a server: another name, or a combinator call around one.
 */
type ServerAlias = {readonly name: string; readonly initializer: Expression; readonly binding: "const" | "let"; readonly span: Span};
/** The velar/serve combinators whose result carries its app argument's paths through, or translated. */
type ServeCombinator = "prefix" | "use" | "bodyLimit" | "docs" | "lifecycle";
const serveCombinators: ReadonlySet<string> = new Set<ServeCombinator>(["prefix", "use", "bodyLimit", "docs", "lifecycle"]);
/** A spread target the analyzer resolved: the declaring server, seen through zero or more literal prefixes. */
type ComposedServer = {readonly server: NodeServerDeclaration; readonly prefix: string};

type NodeResponseMetadata = {readonly status: number | null; readonly contentType: string; readonly payload?: ValueType};
type NodeResponseValueType = ValueType & {readonly nodeResponse?: NodeResponseMetadata};

export type RouteParameterSource = "body" | "request" | "header" | "cookie" | "form" | "upload" | "dependency" | "security" | "connection";
export type RouteParameterKind = "string" | "number" | "bool" | "enum" | "list" | "data" | "request" | "upload" | "dependency" | "security" | "connection";
type OpenApiSchema = Readonly<Record<string, unknown>>;

export function routeParameterHint(source: RouteParameterSource, kind: RouteParameterKind, schema: OpenApiSchema, descriptor = false): string {
  return `${routeHintPrefix}${JSON.stringify({ source, kind, schema, descriptor })}`;
}

export function parseRouteParameterHint(value: string | undefined): {
  readonly source: RouteParameterSource;
  readonly kind: RouteParameterKind;
  readonly schema: OpenApiSchema;
  readonly descriptor: boolean;
} | null {
  if (!value?.startsWith(routeHintPrefix)) return null;
  try {
    const parsed = JSON.parse(value.slice(routeHintPrefix.length)) as Partial<{
      source: RouteParameterSource;
      kind: RouteParameterKind;
      schema: OpenApiSchema;
      descriptor: boolean;
    }>;
    if (!parsed.source || !parsed.kind || !parsed.schema || typeof parsed.schema !== "object") return null;
    return { source: parsed.source, kind: parsed.kind, schema: parsed.schema, descriptor: parsed.descriptor === true };
  } catch {
    return null;
  }
}

export function routeResultHint(schema: OpenApiSchema, contentTypes: readonly string[], status: number | null): string {
  return `${routeResultHintPrefix}${JSON.stringify({schema, contentTypes, status})}`;
}

export function parseRouteResultHint(value: string | undefined): {readonly schema: OpenApiSchema; readonly contentTypes: readonly string[]; readonly status: number | null} | null {
  if (!value?.startsWith(routeResultHintPrefix)) return null;
  try {
    const parsed = JSON.parse(value.slice(routeResultHintPrefix.length)) as {schema?: unknown; contentTypes?: unknown; status?: unknown};
    if (!parsed || typeof parsed !== "object" || !parsed.schema || typeof parsed.schema !== "object" || Array.isArray(parsed.schema)
      || !Array.isArray(parsed.contentTypes) || !parsed.contentTypes.every((item) => typeof item === "string")
      || parsed.status !== null && (typeof parsed.status !== "number" || !Number.isSafeInteger(parsed.status) || parsed.status < 200 || parsed.status > 599)) return null;
    return {schema: parsed.schema as OpenApiSchema, contentTypes: parsed.contentTypes, status: parsed.status};
  } catch {
    return null;
  }
}

/**
 * p"..." 中的命名类型会在分析阶段解析到真正的枚举声明。生成器只看到原始
 * TypeSyntax，无法自行恢复枚举的线值，因此把已经验证过的 schema 随 lowering
 * hints 传下去；运行时校验与 OpenAPI 由此继续使用同一个类型事实。
 */
export function routeCaptureHint(kind: "string" | "number" | "bool" | "enum", schema: OpenApiSchema): string {
  return `${routeCaptureHintPrefix}${JSON.stringify({kind, schema})}`;
}

export function parseRouteCaptureHint(value: string | undefined): {readonly kind: "string" | "number" | "bool" | "enum"; readonly schema: OpenApiSchema} | null {
  if (!value?.startsWith(routeCaptureHintPrefix)) return null;
  try {
    const parsed = JSON.parse(value.slice(routeCaptureHintPrefix.length)) as {kind?: unknown; schema?: unknown};
    return parsed && typeof parsed === "object" && (parsed.kind === "string" || parsed.kind === "number" || parsed.kind === "bool" || parsed.kind === "enum")
      && parsed.schema && typeof parsed.schema === "object" && !Array.isArray(parsed.schema)
      ? {kind: parsed.kind, schema: parsed.schema as OpenApiSchema}
      : null;
  } catch {
    return null;
  }
}

export class VelarNodeAnalyzer extends Analyzer {
  private readonly contextualRouteParameters = new Map<string, ValueType>();
  private readonly routeInputs = new Map<string, NodeRouteInputType>();
  /** Servers declared by the module under analysis, the only spread targets this analyzer can resolve. */
  private readonly moduleServers = new Map<string, NodeServerDeclaration>();
  /** Module-level `const alias = name` and `let alias = name` bindings, so a spread of an alias resolves to the server it names. */
  private readonly moduleServerAliases = new Map<string, ServerAlias>();
  /** Local names imported from velar/serve that name a path-preserving combinator, so a spread of a call resolves through it. */
  private readonly moduleServeCombinators = new Map<string, {readonly imported: ServeCombinator; readonly span: Span}>();
  /** One answer per `let` alias name to "was this binding ever reassigned?", because the predicate walks the whole program. */
  private readonly stableAliases = new Map<string, boolean>();
  /** The program under analysis, held for the alias-stability walk. */
  private moduleProgram: Program | null = null;
  /** 当前模块可静态解析的路由目录，包含通过接口注解导入的常量。 */
  private routePatternValues: ReadonlyMap<string, RoutePatternStaticValue> = new Map();
  private readonly importedRoutePatternValues: ReadonlyMap<string, RoutePatternStaticValue>;
  /** 每条路由最终采用的编译期模板；碰撞检查和形参类型都读取这里。 */
  private readonly routePatterns = new Map<string, CompiledRoutePattern>();
  private readonly nodeModulePath: string | null;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.nodeModulePath = context.path ?? null;
    this.importedRoutePatternValues = new Map(
      [...(context.extensionImports?.get("@velarscript/node") ?? [])]
        .filter((entry): entry is [string, RoutePatternStaticValue] => isRoutePatternStaticValue(entry[1])),
    );
  }

  override analyze(program: Program) {
    this.moduleServers.clear();
    this.moduleServerAliases.clear();
    this.moduleServeCombinators.clear();
    this.stableAliases.clear();
    this.moduleProgram = program;
    this.routePatternValues = collectRoutePatternValues(program, this.importedRoutePatternValues);
    this.routePatterns.clear();
    for (const statement of program.body) {
      if (isNodeServerStatement(statement)) {
        if (!this.moduleServers.has(statement.name)) this.moduleServers.set(statement.name, statement);
        continue;
      }
      if (statement.kind === "ImportDeclaration" && statement.source === "velar/serve") {
        for (const specifier of statement.specifiers) {
          if (specifier.namespace || !serveCombinators.has(specifier.imported)) continue;
          if (!this.moduleServeCombinators.has(specifier.local)) {
            this.moduleServeCombinators.set(specifier.local, {imported: specifier.imported as ServeCombinator, span: specifier.span});
          }
        }
        continue;
      }
      const alias = moduleServerAlias(statement);
      if (alias && !this.moduleServerAliases.has(alias.name)) this.moduleServerAliases.set(alias.name, alias);
    }
    if (!(this.nodeModulePath ?? "").endsWith(".test.vel")) {
      for (const statement of program.body) {
        if ((statement.kind === "ImportDeclaration" || statement.kind === "ReExportDeclaration") && statement.source === "velar/server-test") {
          this.typeError("'velar/server-test' is an in-process test capability; import it only from a '*.test.vel' module", statement.sourceSpan);
        }
      }
    }
    return super.analyze(program);
  }

  protected override predeclareExtensionStatement(statement: Statement): boolean {
    if (!isNodeServerStatement(statement)) return false;
    this.declareBinding(statement.name, false, serveAppType, statement.span);
    return true;
  }

  protected override analyzeExtensionStatement(statement: Statement): boolean {
    if (!isNodeServerStatement(statement)) return false;
    this.analyzeServer(statement);
    return true;
  }

  protected override contextualFunctionParameterDefault(
    statement: { readonly kind: string },
    parameter: Parameter,
  ): ValueType | null {
    if (statement.kind !== "NodeRouteDeclaration" || !parameter.defaultValue) return null;
    const route = statement as NodeRouteDeclaration;
    if (route.routeBinding?.name === parameter.name) {
      return this.boundRoutePathType(this.staticPattern(route));
    }
    const inferred = this.expandAliases(this.inferParameterDefault(parameter.defaultValue));
    const key = `${parameter.span.start}:${parameter.span.end}`;
    if (isNodeRouteInputType(inferred)) {
      this.routeInputs.set(key, inferred);
      const value = this.expandAliases(nodeRouteInputValue(inferred));
      this.contextualRouteParameters.set(key, value);
      return value;
    }
    this.contextualRouteParameters.set(key, inferred);
    return inferred;
  }

  protected override inferExtensionExpression(expression: Expression, _contextualType: ValueType): ValueType | undefined {
    if (expression.kind !== "ExtensionExpression:node:path-pattern") return undefined;
    const pattern = (expression as typeof expression & {readonly pattern: CompiledRoutePattern}).pattern;
    for (const capture of pattern.path.concat(pattern.query)) this.recordRouteCaptureHint(capture, this.routeCaptureType(capture));
    return routePatternType;
  }

  private staticPattern(route: NodeRouteDeclaration): CompiledRoutePattern | null {
    const cached = this.routePatterns.get(spanIdentity(route.span));
    if (cached) return cached;
    const value = evaluateRoutePatternExpression(route.pathExpression, this.routePatternValues);
    if (!isCompiledRoutePattern(value)) return null;
    this.routePatterns.set(spanIdentity(route.span), value);
    return value;
  }

  private routePath(route: NodeRouteDeclaration): string {
    return this.staticPattern(route)?.pathname ?? route.path;
  }

  /**
   * 路由模板就是处理函数的签名来源。字段类型在这里解析一次，正文随后看到
   * `path.params` 与 `path.query` 的精确只读结构；可选查询字段自然得到 `T?`。
   */
  private boundRoutePathType(pattern: CompiledRoutePattern | null): ValueType {
    const fields = (captures: readonly RoutePatternCapture[], query: boolean): ValueType => {
      const values = new Map<string, ValueType>();
      const optionalFields = new Set<string>();
      for (const capture of captures) {
        const resolved = this.routeCaptureType(capture);
        values.set(capture.name, capture.optional ? optionalOf(resolved) : resolved);
        if (capture.optional) optionalFields.add(capture.name);
        const scalar = scalarKind(resolved);
        if (scalar && scalar !== "list") this.recordRouteCaptureHint(capture, resolved);
        if (!scalar || scalar === "list") {
          this.typeError(`Route field '${capture.name}' must be string, number, bool, or an enum; received ${describeType(resolved)}`, capture.typeSpan);
        }
        if (!query && capture.optional) this.typeError(`Path field '${capture.name}' cannot be optional`, capture.span);
      }
      return {kind: "object", fields: values, optionalFields, readonlyFields: new Set(values.keys())};
    };
    const params = fields(pattern?.path ?? [], false);
    const query = fields(pattern?.query ?? [], true);
    return nodeBoundRoutePathType(params, query);
  }

  private routeCaptureType(capture: RoutePatternCapture): ValueType {
    if (capture.resolvedType) return this.expandAliases(capture.resolvedType);
    const reference = {
      syntax: {kind: "NamedTypeSyntax", name: capture.typeName, span: capture.typeSpan} as const,
      span: capture.typeSpan,
    };
    return this.expandAliases(this.resolveValidatedAnnotation(reference));
  }

  private recordRouteCaptureHint(capture: RoutePatternCapture, resolved: ValueType): void {
    const scalar = scalarKind(resolved);
    if (!scalar || scalar === "list") return;
    this.extensionCalls.set(
      spanIdentity(capture.typeSpan),
      routeCaptureHint(scalar, openApiSchema(resolved, (identity) => this.fieldsOf(identity), new Set(), (identity) => this.enumValuesOf(identity))),
    );
  }

  private analyzeServer(statement: NodeServerDeclaration): void {
    if (!this.isTopLevelScope()) {
      this.typeError("A server is a module declaration; move it to the top level", statement.span);
    }
    if (!this.isPredeclared(statement)) this.declareBinding(statement.name, false, serveAppType, statement.span);

    const routes = new Map<string, ComposedRoute>();
    let notFound: ComposedFallback | null = null;
    let responsePolicy: NodeResponseDeclaration | null = null;
    for (const item of statement.items) {
      if (item.kind === "NodeServerSpread") {
        this.requireAssignable(this.inferExpression(item.value, serveAppType), serveAppType, item.value.span);
        const composed = this.composedItems(statement, item);
        if (!composed) continue;
        if (composed.notFound) {
          if (notFound) this.typeError(describeFallbackCollision(notFound, composed.notFound), item.span);
          else notFound = composed.notFound;
        }
        if (composed.responsePolicy) {
          if (responsePolicy) this.typeError("A server can declare only one @response policy", item.span);
          else responsePolicy = composed.responsePolicy;
        }
        for (const entry of composed.routes) this.recordRoute(entry, routes, item.span);
        continue;
      }
      if (item.kind === "NodeNotFoundDeclaration") {
        const written: ComposedFallback = {fallback: item, spread: null, origin: []};
        if (notFound) this.typeError(describeFallbackCollision(notFound, written), item.span);
        else notFound = written;
        this.analyzeNotFound(item);
        continue;
      }
      if (item.kind === "NodeResponseDeclaration") {
        if (responsePolicy) this.typeError("A server can declare only one @response policy", item.span);
        else responsePolicy = item;
        this.analyzeResponse(item);
        continue;
      }
      this.recordRoute({route: item, path: this.routePath(item), spread: null, origin: []}, routes, item.pathSpan);
      this.analyzeRoute(item);
    }
  }

  /**
   * Enters one route into this server's shape map and compares it against every route already
   * entered, whether that route was written here or composed in by a spread. Composition is why the
   * entries carry an origin: a conflicting route the author cannot see in his own file has to name
   * the server it came from.
   */
  private recordRoute(entry: ComposedRoute, routes: Map<string, ComposedRoute>, span: Span): void {
    const key = `${entry.route.method} ${routeShape(entry.path)}`;
    const previous = routes.get(key);
    if (previous) {
      this.typeError(describeRouteCollision(previous, entry), span);
      return;
    }
    // Two routes of one method can share a concrete path. Where one declares a literal at every
    // position the other does and more, the router's literal-beats-capture score picks it every
    // time, which is the intended precedence behind '/users/me' beside '/users/{id:string}'.
    // Where neither is more specific the winner is declaration order alone and the loser can
    // never run, so the overlap is an error. A pair whose shared path is unrealizable — a
    // '{n:number}' capture against the literal 'b' — is not an overlap.
    const segments = routeSegments(entry.path);
    for (const other of routes.values()) {
      if (other.route.method !== entry.route.method) continue;
      // Two routes one spread composed in were already compared against each other while that
      // server was analyzed; reporting them again here would duplicate its diagnostic.
      if (entry.spread !== null && other.spread === entry.spread) continue;
      const declared = routeSegments(other.path);
      if (routeSpecificityDecides(declared, segments)) continue;
      const shared = routeSharedPath(declared, segments);
      if (shared === null) continue;
      this.typeError(
        `Route ${describeComposedRoute(other)} overlaps ${describeComposedRoute(entry)}; both match '${shared}' and neither is more specific — narrow or remove one`,
        span,
      );
    }
    routes.set(key, entry);
  }

  /**
   * The routes and fallback a spread composes into the server that writes it, or null when the
   * spread is not statically resolvable. This analyzer sees one module, so a spread contributes
   * only when its value reaches a server declared in this module: a plain identifier, an alias of
   * one, or a velar/serve combinator call around one — `use`, `bodyLimit`, `docs` and `lifecycle`
   * carry paths through unchanged, and `prefix` translates them by its literal path. An imported
   * server, a computed prefix path, or any other expression is let through unchecked, because a
   * false conflict here would block a correct program; D90 R19's runtime referee judges the final
   * table at assembly instead. Composition is followed transitively; the visited set bounds a
   * cycle and starts holding the composing server, so a cycle never folds a server's own routes
   * back into itself and reports each as conflicting with itself.
   */
  private composedItems(
    statement: NodeServerDeclaration,
    spread: NodeServerSpread,
  ): {readonly routes: readonly ComposedRoute[]; readonly notFound: ComposedFallback | null; readonly responsePolicy: NodeResponseDeclaration | null} | null {
    const target = this.resolveComposedServer(spread.value);
    if (!target) return null;
    const routes: ComposedRoute[] = [];
    const shapes = new Set<string>();
    const visited = new Set<NodeServerDeclaration>([statement]);
    let notFound: ComposedFallback | null = null;
    let responsePolicy: NodeResponseDeclaration | null = null;
    const collect = (server: NodeServerDeclaration, prefix: string, origin: readonly string[]): void => {
      if (visited.has(server)) return;
      visited.add(server);
      for (const item of server.items) {
        if (item.kind === "NodeServerSpread") {
          const nested = this.resolveComposedServer(item.value);
          if (nested) collect(nested.server, prefix + nested.prefix, [...origin, nested.server.name]);
          continue;
        }
        if (item.kind === "NodeNotFoundDeclaration") {
          if (prefix !== "") {
            this.typeError("prefix cannot scope @notFound; compose the fallback on the final server instead", spread.span);
          } else notFound ??= {fallback: item, spread, origin};
          continue;
        }
        if (item.kind === "NodeResponseDeclaration") {
          // @response 是最终应用的全局表示策略，前缀只能改变路径，无法缩小它
          // 的作用域。静态可见时在这里拒绝，避免构建应用时才出现跨路由副作用。
          if (prefix !== "") {
            this.typeError("prefix cannot scope @response; compose the policy on the final server instead", spread.span);
          } else responsePolicy ??= item;
          continue;
        }
        // A server that conflicts with itself already reported it; one entry per shape is what
        // reaches the composing server, exactly as one entry per shape reaches its own map.
        const path = prefixedRoutePath(prefix, this.routePath(item));
        const shape = `${item.method} ${routeShape(path)}`;
        if (shapes.has(shape)) continue;
        shapes.add(shape);
        routes.push({route: item, path, spread, origin});
      }
    };
    collect(target.server, target.prefix, [target.server.name]);
    return {routes, notFound, responsePolicy};
  }

  /**
   * The server declaration a spread value names, or null when it is anything else. A
   * `const other = base` alias chain of this module's own servers resolves too, because the alias
   * holds exactly that ServeApp — and so does a `let` alias the whole module never reassigns,
   * because an unwritten `let` holds its initializer exactly as a `const` does. A reassigned or
   * ambiguous `let`, a member path, a conditional, an import, or a parameter contributes nothing.
   * A call resolves through the path-preserving velar/serve combinators when the callee still
   * reaches its velar/serve import: `prefix` with a literal path translates what its app argument
   * declares, and `use`/`bodyLimit`/`docs`/`lifecycle` pass it through untouched. A computed
   * prefix path contributes nothing — the assembly-time referee owns it. An alias's initializer
   * re-enters this resolver whole, so `const scoped = prefix("/api", routes)` resolves exactly as
   * the spelled-out spread does; the followed set bounds an alias cycle.
   */
  private resolveComposedServer(value: Expression, followed: Set<string> = new Set()): ComposedServer | null {
    if (value.kind === "CallExpression" && !value.optional) {
      if (value.callee.kind !== "IdentifierExpression") return null;
      const combinator = this.moduleServeCombinators.get(value.callee.name);
      if (!combinator || !this.resolvesTo(value.callee.name, combinator.span)) return null;
      const appIndex = combinator.imported === "prefix" ? 1 : 0;
      const app = value.arguments[appIndex];
      if (!app || value.argumentNames?.slice(0, appIndex + 1).some((argumentName) => argumentName !== null)) return null;
      const inner = this.resolveComposedServer(app, followed);
      if (!inner) return null;
      if (combinator.imported !== "prefix") return inner;
      const path = value.arguments[0];
      if (!path || path.kind !== "LiteralExpression" || typeof path.value !== "string") return null;
      // The same literal shapes the runtime accepts; anything else is the runtime referee's to
      // refuse, and claiming routes for it here would report conflicts against a table that
      // never assembles.
      if (path.value === "/") return inner;
      if (!path.value.startsWith("/") || path.value.endsWith("/") || /[{}*?#\\]|\/\//u.test(path.value)) return null;
      return {server: inner.server, prefix: path.value + inner.prefix};
    }
    if (value.kind !== "IdentifierExpression") return null;
    const name = value.name;
    const declaration = this.moduleServers.get(name);
    if (declaration) return this.resolvesTo(name, declaration.span) ? {server: declaration, prefix: ""} : null;
    const alias = this.moduleServerAliases.get(name);
    if (!alias || followed.has(name) || !this.resolvesTo(name, alias.span)) return null;
    if (alias.binding === "let" && !this.aliasBindingIsStable(alias)) return null;
    followed.add(name);
    return this.resolveComposedServer(alias.initializer, followed);
  }

  /** Whether a `let` alias has never been reassigned, asked once per name and program. */
  private aliasBindingIsStable(alias: ServerAlias): boolean {
    const cached = this.stableAliases.get(alias.name);
    if (cached !== undefined) return cached;
    const stable = this.moduleProgram !== null && bindingNeverReassigned(this.moduleProgram, alias.name, alias.span);
    this.stableAliases.set(alias.name, stable);
    return stable;
  }

  /**
   * Whether a name still reaches the declaration this module recorded for it. An import, a
   * shadowing binding, or a parameter of the same name reaches a different binding.
   */
  private resolvesTo(name: string, span: Span): boolean {
    const binding = this.lookup(name);
    return binding !== null && spanIdentity(binding.span) === spanIdentity(span);
  }

  private analyzeNotFound(fallback: NodeNotFoundDeclaration): void {
    this.analyzeFunctionDeclaration(fallback, null, true, false, true, "Not-found fallback");
    if (fallback.parameters.length > 1) {
      this.typeError("@notFound accepts at most one Request parameter", fallback.signatureSpan);
    }
    const parameter = fallback.parameters[0];
    if (parameter) {
      if (parameter.rest) this.typeError("@notFound Request cannot be a rest parameter", parameter.span);
      if (parameter.defaultValue) this.typeError("@notFound Request is supplied by the server and cannot have a default value", parameter.span);
      if (!parameter.type) this.typeError("@notFound Request requires the explicit Request type", parameter.span);
      else {
        const resolved = this.expandAliases(this.resolveValidatedAnnotation(parameter.type));
        if (!isServeRequestType(resolved)) this.typeError(`@notFound parameter must be Request; received ${describeType(resolved)}`, parameter.span);
      }
    }
    const result = this.expandAliases(this.inferredFunctionResult(fallback));
    if (!isRouteResult(result, (identity) => this.fieldsOf(identity), new Set())) {
      this.typeError(
        `@notFound must return Data or a response from velar/serve; received ${describeType(result)}`,
        fallback.returnType?.span ?? fallback.span,
      );
    }
  }

  private analyzeResponse(handler: NodeResponseDeclaration): void {
    this.analyzeFunctionDeclaration(handler, null, true, false, true, "Response policy");
    if (handler.parameters.length < 1 || handler.parameters.length > 2) {
      this.typeError("@response declares (outcome: HttpOutcome) or (outcome: HttpOutcome, request: Request)", handler.signatureSpan);
    }
    for (const [index, parameter] of handler.parameters.entries()) {
      if (parameter.rest) this.typeError("@response parameters cannot be rest parameters", parameter.span);
      if (parameter.defaultValue) this.typeError("@response parameters are supplied by the framework and cannot have defaults", parameter.span);
      if (!parameter.type) {
        this.typeError(`@response parameter ${index + 1} requires an explicit ${index === 0 ? "HttpOutcome" : "Request"} type`, parameter.span);
        continue;
      }
      const resolved = this.expandAliases(this.resolveValidatedAnnotation(parameter.type));
      const valid = index === 0
        ? resolved.kind === "named" && (resolved.identity === VELAR_HTTP_OUTCOME_IDENTITY || resolved.name === "HttpOutcome")
        : isServeRequestType(resolved);
      if (!valid) this.typeError(`@response parameter ${index + 1} must be ${index === 0 ? "HttpOutcome" : "Request"}; received ${describeType(resolved)}`, parameter.span);
    }
    const result = this.expandAliases(this.inferredFunctionResult(handler));
    this.extensionCalls.set(
      spanIdentity(handler.signatureSpan),
      routeResultHint(
        openApiResponseSchema(result, (identity) => this.fieldsOf(identity), new Set(), (identity) => this.enumValuesOf(identity)),
        openApiResponseContentTypes(result),
        null,
      ),
    );
    if (!isResponsePolicyResult(result, (identity) => this.fieldsOf(identity), new Set())) {
      this.typeError(`@response must return Data or a final response from velar/serve; received ${describeType(result)}`, handler.returnType?.span ?? handler.span);
    }
  }

  private analyzeRoute(route: NodeRouteDeclaration): void {
    this.requireAssignable(this.inferExpression(route.pathExpression, routePatternType), routePatternType, route.pathExpression.span);
    const pattern = this.staticPattern(route);
    if (!pattern) this.typeError("A route path must be statically resolvable from p\"...\"", route.pathSpan);
    // 两种作用域模式共享同一份捕获验证与 OpenAPI 类型提示。对象模式随后把
    // 这个形状交给 route 绑定；投影模式的合成参数则分别声明每个字段。
    if (route.routeBinding === null) this.boundRoutePathType(pattern);
    this.analyzeFunctionDeclaration(route, null, true, false, true, "Route");

    let bodies = 0;
    let forms = 0;
    let requests = 0;
    let connections = 0;
    const declared = new Set<string>();
    for (const parameter of route.inputParameters) {
      if (declared.has(parameter.name)) {
        this.typeError(`Route parameter '${parameter.name}' is declared more than once`, parameter.span);
      }
      declared.add(parameter.name);
      const key = `${parameter.span.start}:${parameter.span.end}`;
      const routeInput = this.routeInputs.get(key);
      if (!parameter.type && !this.contextualRouteParameters.has(key)) {
        this.typeError(`Route parameter '${parameter.name}' requires an explicit type`, parameter.span);
        continue;
      }
      const resolved = parameter.type
        ? this.expandAliases(this.resolveValidatedAnnotation(parameter.type))
        : this.contextualRouteParameters.get(key) ?? unknownType;
      const scalar = scalarKind(resolved);
      let source: RouteParameterSource;
      let kind: RouteParameterKind;

      if (route.transport === "websocket" && isWebSocketConnectionType(resolved)) {
        source = "connection";
        kind = "connection";
        connections += 1;
        if (connections > 1) this.typeError("A @websocket route declares exactly one WebSocketConnection parameter", parameter.span);
        if (parameter.defaultValue) this.typeError("WebSocketConnection is supplied by the framework and cannot have a default value", parameter.span);
      } else if (routeInput) {
        source = routeInput.role;
        if (source === "form" || source === "upload") {
          forms += 1;
          if (route.transport === "websocket" || route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
            this.typeError(`${route.method} routes cannot declare form or upload inputs`, parameter.span);
          }
        }
        if (source === "request") {
          kind = "request";
          requests += 1;
          if (requests > 1) this.typeError("A route can declare only one Request parameter", parameter.span);
        } else if (source === "upload") kind = "upload";
        else if (source === "dependency") kind = "dependency";
        else if (source === "security") kind = "security";
        else kind = scalar ?? "data";
      } else if (isServeRequestType(resolved)) {
        source = "request";
        kind = "request";
        requests += 1;
        if (requests > 1) this.typeError("A route can declare only one Request parameter", parameter.span);
        if (parameter.defaultValue) this.typeError("A Request parameter is supplied by the server and cannot have a default value", parameter.span);
      } else if (scalar) {
        this.typeError(`Scalar route input '${parameter.name}' must be declared in the p\"...?...\" query contract or use an explicit header/cookie/security descriptor`, parameter.span);
        continue;
      } else {
        if (route.transport === "websocket") {
          this.typeError(`@websocket parameter '${parameter.name}' must be WebSocketConnection, Request, or an explicit input descriptor`, parameter.span);
          continue;
        }
        source = "body";
        kind = "data";
        bodies += 1;
        if (route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
          this.typeError(`${route.method} routes do not infer a JSON body; use the route pattern query contract or an explicit Request`, parameter.span);
        }
        if (bodies > 1) this.typeError("A route can declare only one structured JSON body parameter", parameter.span);
        if (parameter.defaultValue) this.typeError("A structured JSON body parameter cannot have a default value", parameter.span);
        if (!isNamedDataRecord(resolved, (identity) => this.fieldsOf(identity), new Set())) {
          this.typeError(`A route body must be a concrete Data record type; received ${describeType(resolved)}`, parameter.span);
        }
      }
      this.extensionCalls.set(
        key,
        routeParameterHint(source, kind, openApiSchema(resolved, (identity) => this.fieldsOf(identity), new Set(), (identity) => this.enumValuesOf(identity)), Boolean(routeInput)),
      );
    }
    if (forms > 0 && bodies > 0) {
      this.typeError("A route cannot combine an inferred JSON body with form or upload inputs", route.span);
    }
    const result = this.expandAliases(this.inferredFunctionResult(route));
    if (route.transport === "websocket") {
      if (connections !== 1) this.typeError("A @websocket route requires exactly one WebSocketConnection parameter", route.signatureSpan);
      if (result.kind !== "null") {
        this.typeError(`@websocket must finish with null; received ${describeType(result)}`, route.returnType?.span ?? route.span);
      }
      return;
    }
    this.extensionCalls.set(
      `${route.signatureSpan.start}:${route.signatureSpan.end}`,
      routeResultHint(
        openApiResponseSchema(result, (identity) => this.fieldsOf(identity), new Set(), (identity) => this.enumValuesOf(identity)),
        openApiResponseContentTypes(result),
        openApiResponseStatus(result),
      ),
    );
    if (!isRouteResult(result, (identity) => this.fieldsOf(identity), new Set())) {
      this.typeError(
        `Route '${route.name}' must return Data or a response from velar/serve; received ${describeType(result)}`,
        route.returnType?.span ?? route.span,
      );
    }
  }
}

const uploadType: ValueType = { kind: "named", name: "Upload", identity: "velar/serve#type:Upload" };

export function inferNodeIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt, expandAliases } = context;
  switch (intrinsic.name) {
    case "serve.response.json": {
      arity(1, 3);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeResponseValue("json", value, literalStatus(argumentAt(1), 200), "application/json");
    }
    case "serve.response.created": {
      arity(1, 2);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeOutcomeValue(value, 201);
    }
    case "serve.response.noContent": {
      arity(0, 2);
      if (argumentAt(0)) inferAt(0, nullType);
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeOutcomeValue(nullType, 204);
    }
    case "serve.response.respond": {
      arity(1, 3);
      const value = inferAt(0, unknownType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeOutcomeValue(value, literalStatus(argumentAt(1), 200));
    }
    case "serve.response.redirect": {
      arity(1, 3);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeResponseValue("text", stringType, literalStatus(argumentAt(1), 302), "text/plain");
    }
    case "serve.response.text": {
      arity(1, 4);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, stringType);
      if (argumentAt(3)) inferAt(3, optionalOf(responseHeadersType));
      return nodeResponseValue("text", stringType, literalStatus(argumentAt(1), 200), "text/plain");
    }
    case "serve.response.sse": {
      arity(1, 2);
      const producer = callbackAt(0, [sseSendType], {kind: "promise", value: nullType});
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeResponseValue("stream", producer, 200, "text/event-stream");
    }
    case "serve.response.background": {
      arity(2, 2);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      callbackAt(1, [], unknownType);
      return inferred;
    }
    case "serve.response.setCookie": {
      arity(3, 8);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      inferAt(2, stringType);
      if (argumentAt(3)) inferAt(3, stringType);
      if (argumentAt(4)) inferAt(4, boolType);
      if (argumentAt(5)) inferAt(5, boolType);
      if (argumentAt(6)) inferAt(6, stringType);
      if (argumentAt(7)) inferAt(7, optionalOf(numberType));
      return inferred;
    }
    case "serve.response.clearCookie": {
      arity(2, 3);
      const inferred = inferAt(0);
      const response = expandAliases(inferred);
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      if (argumentAt(2)) inferAt(2, stringType);
      return inferred;
    }
    case "serve.input.header":
    case "serve.input.cookie": {
      arity(0, 2);
      inferAt(0, stringType);
      const fallback = argumentAt(1);
      let result: ValueType = stringType;
      if (fallback) {
        const inferred = expandAliases(inferAt(1, { kind: "union", members: [stringType, { kind: "null" }] }));
        if (inferred.kind === "null" || inferred.kind === "optional") result = optionalOf(stringType);
      }
      const source = intrinsic.name.slice("serve.input.".length) as "header" | "cookie";
      return nodeRouteInputType(source, result);
    }
    case "serve.input.form": {
      arity(1, 1);
      return nodeRouteInputType("form", runtimeTypeAt(0));
    }
    case "serve.input.upload": {
      arity(0, 2);
      inferAt(0, stringType);
      if (argumentAt(1)) inferAt(1, { kind: "number" });
      return nodeRouteInputType("upload", uploadType);
    }
    case "serve.input.request": {
      arity(0, 0);
      return nodeRouteInputType("request", serveRequestType);
    }
    case "serve.input.dependency": {
      arity(1, 1);
      const provider = expandAliases(inferAt(0));
      if (!isNodeProviderType(provider)) {
        context.typeError(`input.dependency requires a Provider, received ${describeType(provider)}`, argumentAt(0)?.span ?? callSpan);
        return nodeRouteInputType("dependency", unknownType);
      }
      return nodeRouteInputType("dependency", nodeProviderResult(provider));
    }
    case "serve.security.apiKey": {
      arity(1, 2);
      inferAt(0, stringType);
      inferAt(1, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "apiKey" });
    }
    case "serve.security.basic": {
      arity(0, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", {
        kind: "object",
        fields: new Map([["username", stringType], ["password", stringType]]),
      }, { scheme: "http", protocol: "basic" });
    }
    case "serve.security.bearer": {
      arity(0, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "http", protocol: "bearer" });
    }
    case "serve.security.oauth2": {
      arity(1, 3);
      inferAt(0, stringType);
      inferAt(1, stringType);
      inferAt(2, { kind: "list", element: stringType });
      return nodeRouteInputType("security", stringType, { scheme: "oauth2" });
    }
    case "serve.security.openId": {
      arity(1, 1);
      inferAt(0, stringType);
      return nodeRouteInputType("security", stringType, { scheme: "openIdConnect" });
    }
    case "serve.provide": {
      arity(2, 5);
      const inputs = expandAliases(inferAt(0));
      const resolved = new Map<string, ValueType>();
      if (inputs.kind !== "object") {
        context.typeError(`provide inputs must be an object of input descriptors, received ${describeType(inputs)}`, argumentAt(0)?.span ?? callSpan);
      } else {
        for (const [name, value] of inputs.fields) {
          const descriptor = expandAliases(value);
          if (!isNodeRouteInputType(descriptor)) {
            context.typeError(`Provider input '${name}' must be created by input or security, received ${describeType(descriptor)}`, argumentAt(0)?.span ?? callSpan);
            resolved.set(name, unknownType);
          } else resolved.set(name, nodeRouteInputValue(descriptor));
        }
      }
      const values: ValueType = { kind: "object", fields: resolved };
      const resolver = callbackAt(1, [values], unknownType);
      const rawResult = resolver.kind === "function" || resolver.kind === "action" || resolver.kind === "intrinsic"
        ? resolver.result
        : unknownType;
      const result = expandAliases(rawResult).kind === "promise"
        ? (expandAliases(rawResult) as Extract<ValueType, { kind: "promise" }>).value
        : rawResult;
      if (argumentAt(2)) inferAt(2, stringType);
      if (argumentAt(3)) callbackAt(3, [result], unknownType);
      if (argumentAt(4)) inferAt(4, boolType);
      return nodeProviderType(values, result);
    }
    default:
      return undefined;
  }
}

function literalStatus(expression: ReturnType<CompilerIntrinsicAnalysisContext["argumentAt"]>, fallback: number): number | null {
  if (expression === null) return fallback;
  return expression.kind === "LiteralExpression" && typeof expression.value === "number"
    && Number.isSafeInteger(expression.value) && expression.value >= 200 && expression.value <= 599
    ? expression.value
    : null;
}

function nodeResponseValue(body: "json" | "text" | "stream", value: ValueType, status: number | null, contentType: string): ValueType {
  const fields = new Map<string, ValueType>([["status", numberType], [body, value], ["headers", responseHeadersType]]);
  if (body === "text") fields.set("contentType", stringType);
  const response: NodeResponseValueType = {
    kind: "object",
    fields,
    optionalFields: new Set(body === "text" ? ["contentType", "headers"] : ["headers"]),
    nodeResponse: {status, contentType},
  };
  return response;
}

function nodeOutcomeValue(value: ValueType, status: number | null): ValueType {
  // HttpOutcome 的公开字段描述框架信封，而 OpenAPI 应描述最终发给客户端的
  // 业务值。把 payload 留在编译期元数据里，生成代码时不会携带额外对象。
  return {...httpOutcomeType, nodeResponse: {status, contentType: "application/json", payload: value}} as NodeResponseValueType;
}

function scalarKind(type: ValueType): Extract<RouteParameterKind, "string" | "number" | "bool" | "enum" | "list"> | null {
  const value = type.kind === "optional" ? type.inner : type;
  if (value.kind === "string") return "string";
  if (value.kind === "number") return "number";
  if (value.kind === "bool") return "bool";
  if (value.kind === "enum" || value.kind === "enumMember") return "enum";
  if (value.kind === "list") {
    const element = scalarKind(value.element);
    if (element === "string" || element === "number" || element === "bool" || element === "enum") return "list";
  }
  return null;
}

function isNamedDataRecord(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind !== "named") return false;
  const identity = type.identity ?? type.name;
  const fields = fieldsOf(identity);
  if (!fields) return false;
  if (seen.has(identity)) return true;
  const next = new Set([...seen, identity]);
  return [...fields.values()].every((field) => isData(field, fieldsOf, next));
}

function isData(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind === "null" || type.kind === "string" || type.kind === "number" || type.kind === "bool"
    || type.kind === "enum" || type.kind === "enumMember") return true;
  if (type.kind === "optional") return isData(type.inner, fieldsOf, seen);
  if (type.kind === "list" || type.kind === "record") return isData(type.kind === "list" ? type.element : type.value, fieldsOf, seen);
  if (type.kind === "union") return type.members.every((member) => isData(member, fieldsOf, seen));
  if (type.kind === "object") return [...type.fields.values()].every((field) => isData(field, fieldsOf, seen));
  if (type.kind === "named") {
    if (type.name === "Duration") return true;
    const identity = type.identity ?? type.name;
    if (seen.has(identity)) return true;
    const fields = fieldsOf(identity);
    if (!fields) return false;
    const next = new Set([...seen, identity]);
    return [...fields.values()].every((field) => isData(field, fieldsOf, next));
  }
  return false;
}

function isResponseShape(type: ValueType): boolean {
  if (type.kind !== "object") return false;
  return type.fields.has("status")
    && (type.fields.has("json") || type.fields.has("text") || type.fields.has("stream"));
}

function requireResponseValue(context: CompilerIntrinsicAnalysisContext, type: ValueType, span: Parameters<CompilerIntrinsicAnalysisContext["typeError"]>[1]): void {
  const response = type.kind === "union" ? type.members.every((member) => isResponseShape(member) || isHttpOutcome(member)) : isResponseShape(type) || isHttpOutcome(type);
  if (!response) context.typeError(`Expected a ServeResponse, received ${describeType(type)}`, span);
}

function isHttpOutcome(type: ValueType): boolean {
  return type.kind === "named" && (type.identity === VELAR_HTTP_OUTCOME_IDENTITY || type.name === "HttpOutcome");
}

function isRouteResult(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind === "union") return type.members.every((member) => isRouteResult(member, fieldsOf, seen));
  return isResponseShape(type) || isHttpOutcome(type) || isData(type, fieldsOf, seen);
}

/**
 * 响应策略是语义结果到最终表示的最后一步，因此不能再返回一个 HttpOutcome；
 * 否则会形成第二轮策略选择，并让“只编码一次”的边界变得含糊。
 */
function isResponsePolicyResult(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind === "union") return type.members.every((member) => isResponsePolicyResult(member, fieldsOf, seen));
  return !isHttpOutcome(type) && (isResponseShape(type) || isData(type, fieldsOf, seen));
}

function openApiResponseSchema(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumValuesOf: (identity: string) => readonly string[] | null,
): OpenApiSchema {
  if (type.kind === "union") {
    const schemas = type.members.map((member) => openApiResponseSchema(member, fieldsOf, seen, enumValuesOf));
    return schemas.length === 1 ? schemas[0]! : { anyOf: schemas };
  }
  if (type.kind === "object" && type.fields.has("status")) {
    const json = type.fields.get("json");
    if (json) return openApiSchema(json, fieldsOf, seen, enumValuesOf);
    if (type.fields.has("text") || type.fields.has("stream")) return { type: "string" };
  }
  const metadata = (type as NodeResponseValueType).nodeResponse;
  if (metadata?.payload) return openApiSchema(metadata.payload, fieldsOf, seen, enumValuesOf);
  return openApiSchema(type, fieldsOf, seen, enumValuesOf);
}

function openApiResponseContentTypes(type: ValueType): readonly string[] {
  const output = new Set<string>();
  const visit = (value: ValueType): void => {
    if (value.kind === "union") { value.members.forEach(visit); return; }
    const metadata = (value as NodeResponseValueType).nodeResponse;
    if (metadata) { output.add(metadata.contentType); return; }
    // `status` 也是普通业务数据中很常见的字段，不能只凭字段名就把记录当成
    // ServeResponse。只有同时具备响应载荷字段的框架响应对象，才按载荷种类
    // 推导媒体类型；普通记录仍由 JSON 编码。
    if (value.kind === "object" && isResponseShape(value)) {
      if (value.fields.has("json")) output.add("application/json");
      else if (value.fields.has("text") || value.fields.has("stream")) output.add("text/plain");
      else output.add("application/octet-stream");
      return;
    }
    output.add("application/json");
  };
  visit(type);
  return [...output];
}

function openApiResponseStatus(type: ValueType): number | null {
  const statuses = new Set<number>();
  let unknown = false;
  const visit = (value: ValueType): void => {
    if (value.kind === "union") { value.members.forEach(visit); return; }
    const metadata = (value as NodeResponseValueType).nodeResponse;
    if (metadata) {
      if (metadata.status === null) unknown = true;
      else statuses.add(metadata.status);
      return;
    }
    statuses.add(200);
  };
  visit(type);
  return !unknown && statuses.size === 1 ? [...statuses][0]! : null;
}

function openApiSchema(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumValuesOf: (identity: string) => readonly string[] | null,
): OpenApiSchema {
  if (type.kind === "string" || type.kind === "number" || type.kind === "bool") {
    return { type: type.kind === "bool" ? "boolean" : type.kind };
  }
  if (type.kind === "null") return { type: "null" };
  if (type.kind === "enum") {
    const values = enumValuesOf(type.identity) ?? enumValuesOf(type.name);
    return values ? {type: "string", enum: values} : {type: "string"};
  }
  if (type.kind === "enumMember") return {type: "string", enum: [type.member]};
  if (type.kind === "unknown" || type.kind === "any") return {};
  if (type.kind === "optional") {
    return { anyOf: [openApiSchema(type.inner, fieldsOf, seen, enumValuesOf), { type: "null" }] };
  }
  if (type.kind === "union") {
    return { anyOf: type.members.map((member) => openApiSchema(member, fieldsOf, seen, enumValuesOf)) };
  }
  if (type.kind === "list" || type.kind === "set") {
    return {
      type: "array",
      items: openApiSchema(type.element, fieldsOf, seen, enumValuesOf),
      ...(type.kind === "set" ? { uniqueItems: true } : {}),
    };
  }
  if (type.kind === "record") {
    return { type: "object", additionalProperties: openApiSchema(type.value, fieldsOf, seen, enumValuesOf) };
  }
  if (type.kind === "object") return openApiObjectSchema(type.fields, fieldsOf, seen, enumValuesOf);
  if (type.kind === "named") {
    if (type.name === "Duration") return { type: "number" };
    const identity = type.identity ?? type.name;
    if (seen.has(identity)) return { type: "object" };
    const fields = fieldsOf(identity);
    if (!fields) return {};
    return openApiObjectSchema(fields, fieldsOf, new Set([...seen, identity]), enumValuesOf);
  }
  return {};
}

function openApiObjectSchema(
  fields: ReadonlyMap<string, ValueType>,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumValuesOf: (identity: string) => readonly string[] | null,
): OpenApiSchema {
  const properties = Object.create(null) as Record<string, OpenApiSchema>;
  const required: string[] = [];
  for (const [name, field] of fields) {
    properties[name] = openApiSchema(field, fieldsOf, seen, enumValuesOf);
    if (field.kind !== "optional") required.push(name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

/**
 * A module-level `const name = expression` or `let name = expression` binding, the indirect
 * spellings of a spread target that can still be exactly the value the initializer resolves to: a
 * bare name, or a velar/serve combinator call the resolver sees through. A `let` alias resolves
 * only after the stability predicate confirms the module never reassigns it — that check belongs
 * to the resolver, which is the point that knows the whole program. A pattern binding is excluded
 * because it never holds the whole value.
 */
function moduleServerAlias(statement: Statement): ServerAlias | null {
  if (statement.kind !== "VariableDeclaration") return null;
  const declaration = statement as Statement & {
    readonly binding: "const" | "let";
    readonly pattern: {readonly kind: string; readonly name: string; readonly span: Span};
    readonly initializer: Expression;
  };
  if (declaration.pattern.kind !== "NameBindingPattern") return null;
  if (declaration.initializer.kind !== "IdentifierExpression" && declaration.initializer.kind !== "CallExpression") return null;
  return {name: declaration.pattern.name, initializer: declaration.initializer, binding: declaration.binding, span: declaration.pattern.span};
}

function describeComposedOrigin(entry: ComposedRoute | ComposedFallback): string {
  return entry.origin.map((name) => `'${name}'`).join(" → ");
}

function describeComposedRoute(entry: ComposedRoute): string {
  // The effective path: a route seen through prefix(...) collides at its translated address, and
  // that address is the one the author has to narrow.
  const route = `'${entry.route.method} ${entry.path}'`;
  return entry.origin.length === 0 ? route : `${route} (composed in from ${describeComposedOrigin(entry)})`;
}

/**
 * Why two routes claim one method and shape. Three causes reach this point and each names a
 * different repair, so the message has to tell them apart: one server composed in along two paths
 * declares its route once and cannot be narrowed at all, two routes spelling the same path have no
 * parameter names to blame, and only the third is the shape collision parameter names hide.
 */
function describeRouteCollision(previous: ComposedRoute, entry: ComposedRoute): string {
  // One declaration reaching this server twice is only reachable through spreads: a server's own
  // items are never collected back into it, so both sides carry an origin.
  const declaring = entry.origin[entry.origin.length - 1];
  if (previous.route === entry.route && declaring !== undefined) {
    const paths = describeComposedOrigin(previous) === describeComposedOrigin(entry)
      ? `both times from ${describeComposedOrigin(entry)}`
      : `from ${describeComposedOrigin(previous)} and from ${describeComposedOrigin(entry)}`;
    return `Route '${entry.route.method} ${entry.path}' is composed in twice, ${paths}; '${declaring}' declares it once — remove one spread`;
  }
  if (previous.path === entry.path) {
    return `Route ${describeComposedRoute(entry)} duplicates ${describeComposedRoute(previous)}; one method and path answer from a single route`;
  }
  return `Route ${describeComposedRoute(entry)} conflicts with ${describeComposedRoute(previous)}; parameter names do not make two route shapes distinct`;
}

/**
 * Both sides of a duplicate @notFound. A fallback a spread composes in is invisible in the author's
 * own file, so naming one contributor and not the other leaves him looking for a declaration that
 * is not there; two spreads each composing one name neither by default.
 */
function describeFallbackCollision(previous: ComposedFallback, entry: ComposedFallback): string {
  const rule = "A server can declare only one @notFound fallback";
  if (previous.origin.length === 0 && entry.origin.length === 0) return rule;
  const source = (fallback: ComposedFallback, second: boolean): string => {
    const article = second ? "another" : "one";
    return fallback.origin.length === 0
      ? `this server declares ${article}`
      : `${describeComposedOrigin(fallback)} composes ${article} in`;
  };
  return `${rule}; ${source(previous, false)} and ${source(entry, true)}`;
}

/** A composed route's address as the runtime's `prefix` will spell it: the literal prefix, then the path. */
function prefixedRoutePath(prefix: string, path: string): string {
  if (prefix === "") return path;
  return prefix + (path === "/" ? "" : path);
}

const routeDecimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;

type RouteSegment = {readonly literal: string} | {readonly capture: string; readonly captureType: string};

function routeSegments(path: string): readonly RouteSegment[] {
  return path.split("/").map((segment) => {
    const match = /^\{([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(segment);
    return match ? {capture: match[1]!, captureType: match[2]!} : {literal: segment};
  });
}

function routeCaptureAdmits(captureType: string, literal: string): boolean {
  if (captureType === "number") return routeDecimalPattern.test(literal) && Number.isFinite(Number(literal));
  if (captureType === "bool") return literal === "true" || literal === "false";
  return true;
}

function routeSharedSegment(left: RouteSegment, right: RouteSegment): string | null {
  if ("literal" in left) {
    if ("literal" in right) return left.literal === right.literal ? left.literal : null;
    return routeCaptureAdmits(right.captureType, left.literal) ? left.literal : null;
  }
  if ("literal" in right) return routeCaptureAdmits(left.captureType, right.literal) ? right.literal : null;
  const types = new Set([left.captureType, right.captureType]);
  if (types.has("number") && types.has("bool")) return null;
  if (types.has("number")) return "1";
  if (types.has("bool")) return "true";
  return left.capture;
}

function routeSharedPath(left: readonly RouteSegment[], right: readonly RouteSegment[]): string | null {
  if (left.length !== right.length) return null;
  const shared: string[] = [];
  for (let index = 0; index < left.length; index += 1) {
    const segment = routeSharedSegment(left[index]!, right[index]!);
    if (segment === null) return null;
    shared.push(segment);
  }
  return shared.join("/");
}

function routeLiteralPositions(segments: readonly RouteSegment[]): ReadonlySet<number> {
  const positions = new Set<number>();
  for (let index = 0; index < segments.length; index += 1) if ("literal" in segments[index]!) positions.add(index);
  return positions;
}

function routeSpecificityDecides(left: readonly RouteSegment[], right: readonly RouteSegment[]): boolean {
  const leftLiterals = routeLiteralPositions(left);
  const rightLiterals = routeLiteralPositions(right);
  if (leftLiterals.size === rightLiterals.size) return false;
  const [subset, superset] = leftLiterals.size < rightLiterals.size ? [leftLiterals, rightLiterals] : [rightLiterals, leftLiterals];
  for (const position of subset) if (!superset.has(position)) return false;
  return true;
}
