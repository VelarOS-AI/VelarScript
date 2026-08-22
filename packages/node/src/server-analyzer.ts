import {
  Analyzer,
  bindingNeverReassigned,
  boolType,
  describeType,
  isAssignable,
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
// `compiler.ts` imports this module, so this edge closes a cycle. It is safe
// and deliberate: the declaration is read inside a method, never while either
// module body evaluates, and `compiler.ts` is the only entry into this one.
// The alternative was re-listing the response's fields here, which is the
// drift this repository keeps filing defects against.
import { nodeHttpResponseObjectType } from "./compiler.ts";
import { routeShape } from "./route-shape.ts";
import { isNodeServerStatement, type NodeNotFoundDeclaration, type NodeRouteDeclaration, type NodeServerDeclaration, type NodeServerSpread } from "./server-ast.ts";
import {
  isNodeProviderType,
  isNodeRouteInputType,
  isServeRequestType,
  nodeProviderResult,
  nodeProviderType,
  nodeRouteInputType,
  nodeRouteInputValue,
  serveAppType,
  serveRequestType,
  type NodeRouteInputType,
} from "./server-types.ts";

const routeHintPrefix = "node.route-param:";
const routeResultHintPrefix = "node.route-result:";
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

/**
 * D90 R20: `HttpResponse.ok` was always true, because `response()` throws
 * `HttpResponseError` for every non-2xx before an author can hold the value.
 * The field is gone from the Node response too, and its read keeps the type it
 * always had, so `if not response.ok:` reads exactly one message — the one
 * naming the failure path that does exist — instead of "no field 'ok'"
 * followed by a condition complaining about the missing type. The read and the
 * write reach it by different routes and say the same sentence.
 *
 * The sentence is the one Web's VEL5075 says, character for character: it is
 * the same fact about the same capability, and two spellings of one message is
 * the shape AGENTS.md warns about. It is duplicated rather than shared because
 * packages/node must not depend on packages/web.
 */
const RETIRED_HTTP_RESPONSE_OK = "An HTTP response has no 'ok': a non-2xx status throws 'HttpResponseError' before 'response()' answers, so every response you can hold succeeded. Handle the failure where it is raised — 'catch failure:' then 'if failure is HttpResponseError:' — and read 'failure.status' there";
/** VEL6001-VEL6005 are the server syntax codes and VEL6006 is the CLI's unresolvable JavaScript package import, so this target's next free code is VEL6007. */
const RETIRED_HTTP_RESPONSE_OK_CODE = "VEL6007";

type NodeResponseMetadata = {readonly status: number | null; readonly contentType: string};
type NodeResponseValueType = ValueType & {readonly nodeResponse?: NodeResponseMetadata};

export type RouteParameterSource = "path" | "query" | "body" | "request" | "header" | "cookie" | "form" | "upload" | "dependency" | "security";
export type RouteParameterKind = "string" | "number" | "bool" | "enum" | "list" | "data" | "request" | "upload" | "dependency" | "security";
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
  private readonly nodeModulePath: string | null;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.nodeModulePath = context.path ?? null;
  }

  override analyze(program: Program) {
    this.moduleServers.clear();
    this.moduleServerAliases.clear();
    this.moduleServeCombinators.clear();
    this.stableAliases.clear();
    this.moduleProgram = program;
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

  private analyzeServer(statement: NodeServerDeclaration): void {
    if (!this.isTopLevelScope()) {
      this.typeError("A server is a module declaration; move it to the top level", statement.span);
    }
    if (!this.isPredeclared(statement)) this.declareBinding(statement.name, false, serveAppType, statement.span);

    const routes = new Map<string, ComposedRoute>();
    let notFound: ComposedFallback | null = null;
    for (const item of statement.items) {
      if (item.kind === "NodeServerSpread") {
        this.requireAssignable(this.inferExpression(item.value, serveAppType), serveAppType, item.value.span);
        const composed = this.composedItems(statement, item);
        if (!composed) continue;
        if (composed.notFound) {
          if (notFound) this.typeError(describeFallbackCollision(notFound, composed.notFound), item.span);
          else notFound = composed.notFound;
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
      this.recordRoute({route: item, path: item.path, spread: null, origin: []}, routes, item.pathSpan);
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
  ): {readonly routes: readonly ComposedRoute[]; readonly notFound: ComposedFallback | null} | null {
    const target = this.resolveComposedServer(spread.value);
    if (!target) return null;
    const routes: ComposedRoute[] = [];
    const shapes = new Set<string>();
    const visited = new Set<NodeServerDeclaration>([statement]);
    let notFound: ComposedFallback | null = null;
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
          // The runtime refuses `prefix` around an app with @notFound outright, so a fallback seen
          // through a prefix never reaches any composed table and composing it here would report
          // a duplicate the program cannot have.
          if (prefix === "") notFound ??= {fallback: item, spread, origin};
          continue;
        }
        // A server that conflicts with itself already reported it; one entry per shape is what
        // reaches the composing server, exactly as one entry per shape reaches its own map.
        const path = prefixedRoutePath(prefix, item.path);
        const shape = `${item.method} ${routeShape(path)}`;
        if (shapes.has(shape)) continue;
        shapes.add(shape);
        routes.push({route: item, path, spread, origin});
      }
    };
    collect(target.server, target.prefix, [target.server.name]);
    return {routes, notFound};
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

  private analyzeRoute(route: NodeRouteDeclaration): void {
    const pathNames = validateRoutePath(route.path, route.pathSpan, (message) => this.typeError(message, route.pathSpan));
    this.analyzeFunctionDeclaration(route, null, true, false, true, "Route");

    let bodies = 0;
    let forms = 0;
    let requests = 0;
    const declared = new Set<string>();
    for (const parameter of route.parameters) {
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

      if (pathNames.has(parameter.name)) {
        source = "path";
        pathNames.delete(parameter.name);
        if (!scalar || scalar === "list") {
          this.typeError(`Path parameter '${parameter.name}' must be string, number, bool, or an enum; received ${describeType(resolved)}`, parameter.span);
          continue;
        }
        kind = scalar;
        if (parameter.defaultValue) this.typeError(`Path parameter '${parameter.name}' cannot have a default value`, parameter.span);
      } else if (routeInput) {
        source = routeInput.role;
        if (source === "form" || source === "upload") {
          forms += 1;
          if (route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
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
        source = "query";
        kind = scalar;
      } else {
        source = "body";
        kind = "data";
        bodies += 1;
        if (route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
          this.typeError(`${route.method} routes do not infer a JSON body; use scalar query parameters or an explicit Request`, parameter.span);
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
    for (const missing of pathNames) {
      this.typeError(`Route path capture '${missing}' could not declare its route input; rewrite the capture as '{${missing}:string}'`, route.pathSpan);
    }

    const result = this.expandAliases(this.inferredFunctionResult(route));
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

  protected override analyzeStatement(statement: Statement): void {
    const retiredResponseWrite = this.retiredResponseFieldWrite(statement);
    const firstDiagnostic = this.diagnostics.length;
    super.analyzeStatement(statement);
    this.teachRetiredResponseDestructure(statement, firstDiagnostic);
    if (!retiredResponseWrite) return;
    for (let index = firstDiagnostic; index < this.diagnostics.length; index += 1) {
      const item = this.diagnostics[index]!;
      if (item.code !== "VEL4001" || !item.message.startsWith("Object has no field 'ok'")) continue;
      this.diagnostics[index] = {...item, code: RETIRED_HTTP_RESPONSE_OK_CODE, message: RETIRED_HTTP_RESPONSE_OK};
      break;
    }
  }

  /**
   * D90 R20's third route to the retired field, the same one Web answers.
   * `const {ok} = response` is a read of `ok` that never passes through a
   * `MemberExpression`, so it reached neither the read hook nor the write one
   * and kept the bare "Object has no field 'ok'" — the migration was closed for
   * one spelling of the sink and left open for its neighbour.
   *
   * It is answered after the core has run, not before: the declaration path
   * infers its initializer directly rather than through the member cache, so
   * inferring it first would analyze the initializer twice and double whatever
   * it reports. The type is read back speculatively — everything the
   * re-inference says is a repeat of what the author already has, and is
   * dropped.
   *
   * Only the message is rewritten. The binding still carries `unknown`, so a
   * use of it can still report on its own; that half needs the core to hand a
   * declared type back, which R20 did not rule on.
   */
  private teachRetiredResponseDestructure(statement: Statement, firstDiagnostic: number): void {
    if (statement.kind !== "VariableDeclaration") return;
    const pattern = statement.pattern;
    if (pattern.kind !== "ObjectBindingPattern") return;
    const entries = new Set(pattern.entries.filter((item) => item.property === "ok").map((item) => item.span.start));
    if (entries.size === 0) return;
    let response: boolean | null = null;
    for (let index = firstDiagnostic; index < this.diagnostics.length; index += 1) {
      const item = this.diagnostics[index]!;
      if (item.code !== "VEL4001" || item.message !== "Object has no field 'ok'" || !entries.has(item.span.start)) continue;
      response ??= this.isHttpResponseObject(this.speculativeType(statement.initializer));
      if (!response) return;
      this.diagnostics[index] = {...item, code: RETIRED_HTTP_RESPONSE_OK_CODE, message: RETIRED_HTTP_RESPONSE_OK};
    }
  }

  /** The type of an expression the core has already inferred and reported on, read back without repeating either. */
  private speculativeType(expression: Expression): ValueType {
    const reported = this.diagnostics.length;
    const type = this.expandAliases(this.inferExpression(expression));
    this.diagnostics.splice(reported);
    return type.kind === "optional" ? this.expandAliases(type.inner) : type;
  }

  protected override inferExpression(expression: Expression, contextualType?: ValueType): ValueType {
    // D90 R20: the retired `ok` field, answered before the core reaches it so
    // the migration is the only message. Inferring the receiver here is what
    // identifies the response, and the core's own member path re-reads that
    // inference from its cache rather than analyzing the receiver twice.
    if (expression.kind === "MemberExpression" && expression.property === "ok"
      && this.receiverInferableBeforeMember(expression.object)
      && this.isHttpResponseObject(this.retiredFieldReceiver(expression.object))) {
      this.diagnostics.push({code: RETIRED_HTTP_RESPONSE_OK_CODE, message: RETIRED_HTTP_RESPONSE_OK, span: expression.span});
      return boolType;
    }
    return super.inferExpression(expression, contextualType);
  }

  /**
   * D90 R20 on the assignment side. `response.ok = true` never reaches the read
   * hook: the core analyzes a member assignment target through its member path
   * directly, so the write collected "Object has no field 'ok'" — the one
   * answer that teaches nothing. The receiver is inferred here, before the core
   * reaches it, so the core's own path reads that inference from its cache; the
   * message it then produces is the one replaced above, which keeps the write
   * at exactly one diagnostic instead of a migration stacked on a refusal.
   */
  private retiredResponseFieldWrite(statement: Statement): boolean {
    if (statement.kind !== "AssignmentStatement") return false;
    const target = (statement as Statement & {readonly target: Expression}).target;
    if (target.kind !== "MemberExpression" || target.property !== "ok") return false;
    if (!this.receiverInferableBeforeMember(target.object)) return false;
    return this.isHttpResponseObject(this.retiredFieldReceiver(target.object));
  }

  /**
   * The receiver of a retired `ok`, resolved the way the read itself resolves
   * it: aliases expanded, and an optional chain answered by the value behind
   * the `?`, so `maybe?.ok` reads the same message a plain read does.
   */
  private retiredFieldReceiver(receiver: Expression): ValueType {
    const owner = this.expandAliases(this.inferExpression(receiver));
    return owner.kind === "optional" ? this.expandAliases(owner.inner) : owner;
  }

  /**
   * Whether the receiver can be inferred *before* the core's member path runs.
   * That path registers its receiver as a member-access position on the way
   * down, and the core refuses two names read outside one: a permanent
   * namespace ("'Json' is a namespace, not a value", D51 rule 106) and a class
   * name ("a class name is not a value", D45 rule 75). Both are the same sink
   * — a name whose only legal expression position is the head of a member
   * access — so both stand aside here.
   *
   * A namespace has no lexical binding, so an identifier ordinary lookup
   * cannot resolve is left for the core to infer in its own position. A class
   * name does have one, and its binding says so, which is what a static read
   * like `Result.ok` is recognised by. Every other receiver shape — a call, a
   * member chain, an index — registers itself as it descends.
   */
  private receiverInferableBeforeMember(receiver: Expression): boolean {
    if (receiver.kind !== "IdentifierExpression") return true;
    const binding = this.lookup(receiver.name);
    return binding !== null && this.expandAliases(binding.type).kind !== "classConstructor";
  }

  /**
   * The response is a structural object with no identity of its own, so its
   * shape is what recognises it — matched against the declaration itself,
   * field types included, and read out of `compiler.ts` rather than re-listed
   * here. Matching the nine names alone would report the retirement against any
   * record that happens to spell them, and a record of nine numbers is not an
   * HTTP response. `compiler.ts` imports this module, so that edge closes a
   * cycle; it is safe and deliberate, because the declaration is read here
   * while a program is analyzed, never while either module body evaluates.
   */
  private isHttpResponseObject(type: ValueType): boolean {
    const declaration = nodeHttpResponseObjectType;
    if (declaration.kind !== "object") return false;
    if (type.kind !== "object" || type.fields.size !== declaration.fields.size) return false;
    for (const [name, declared] of declaration.fields) {
      const field = type.fields.get(name);
      if (!field || !isAssignable(field, declared, this)) return false;
    }
    return true;
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
      return nodeResponseValue("json", value, 201, "application/json");
    }
    case "serve.response.noContent": {
      arity(0, 2);
      if (argumentAt(0)) inferAt(0, nullType);
      if (argumentAt(1)) inferAt(1, optionalOf(responseHeadersType));
      return nodeResponseValue("text", stringType, 204, "text/plain");
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
      const response = expandAliases(inferAt(0));
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      callbackAt(1, [], unknownType);
      return response;
    }
    case "serve.response.setCookie": {
      arity(3, 8);
      const response = expandAliases(inferAt(0));
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      inferAt(2, stringType);
      if (argumentAt(3)) inferAt(3, stringType);
      if (argumentAt(4)) inferAt(4, boolType);
      if (argumentAt(5)) inferAt(5, boolType);
      if (argumentAt(6)) inferAt(6, stringType);
      if (argumentAt(7)) inferAt(7, optionalOf(numberType));
      return response;
    }
    case "serve.response.clearCookie": {
      arity(2, 3);
      const response = expandAliases(inferAt(0));
      requireResponseValue(context, response, argumentAt(0)?.span ?? callSpan);
      inferAt(1, stringType);
      if (argumentAt(2)) inferAt(2, stringType);
      return response;
    }
    case "serve.input.query":
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
      const source = intrinsic.name.slice("serve.input.".length) as "query" | "header" | "cookie";
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

function scalarKind(type: ValueType): Exclude<RouteParameterKind, "data" | "request"> | null {
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
  const response = type.kind === "union" ? type.members.every(isResponseShape) : isResponseShape(type);
  if (!response) context.typeError(`Expected a ServeResponse, received ${describeType(type)}`, span);
}

function isRouteResult(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind === "union") return type.members.every((member) => isRouteResult(member, fieldsOf, seen));
  return isResponseShape(type) || isData(type, fieldsOf, seen);
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
  return openApiSchema(type, fieldsOf, seen, enumValuesOf);
}

function openApiResponseContentTypes(type: ValueType): readonly string[] {
  const output = new Set<string>();
  const visit = (value: ValueType): void => {
    if (value.kind === "union") { value.members.forEach(visit); return; }
    const metadata = (value as NodeResponseValueType).nodeResponse;
    if (metadata) { output.add(metadata.contentType); return; }
    if (value.kind === "object" && value.fields.has("status")) {
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

function validateRoutePath(path: string, _sourceSpan: { readonly start: number; readonly end: number }, report: (message: string) => void): Set<string> {
  const names = new Set<string>();
  if (!path.startsWith("/")) report("A route path must start with '/'");
  if (path.length > 1 && path.endsWith("/")) report("A route path must not end with '/' unless it is the root path");
  if (path.includes("?") || path.includes("#")) report("A route path contains only its pathname; declare query parameters in the route signature");
  if (path.includes("\\")) report("A route path uses '/', never a backslash");
  if (path.includes("//")) report("A route path cannot contain an empty segment");
  const segments = path.split("/").slice(1);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment === "*") {
      report("A source route does not use wildcards; compose staticFiles(...) for a checked file fallback");
      continue;
    }
    if (!segment.startsWith("{") && !segment.endsWith("}")) continue;
    const match = /^\{([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(segment);
    if (!match) {
      report(`Route path capture '${segment}' must use '{name:type}' with a half-width ':'`);
      continue;
    }
    const name = match[1]!;
    if (names.has(name)) report(`Route path capture '${name}' appears more than once`);
    else names.add(name);
  }
  return names;
}
