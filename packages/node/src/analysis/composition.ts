/**
 * A server declaration, and everything a spread composes into it.
 *
 * D115 P4 R4a. One module is all this analyzer sees, so a spread contributes
 * routes only when its value still reaches a server declared here — directly,
 * through an alias, or through the `velar/serve` combinators that carry paths
 * through. Anything else is let through unchecked and judged by D90 R19's
 * runtime referee when the table is finally assembled, because a false conflict
 * reported here would block a correct program.
 */
import { bindingNeverReassigned, spanIdentity, type Expression, type Program, type Span, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { type ComposedFallback, type ComposedRoute, type ComposedServer, type ServeCombinator, type ServerAlias } from "../contracts.ts";
import { routeSegments, routeSharedPath, routeSpecificityDecides } from "../route-overlap.ts";
import { routeShape } from "../route-shape.ts";
import { type NodeResponseDeclaration, type NodeServerDeclaration, type NodeServerSpread } from "../server-ast.ts";
import { serveAppType } from "../server-types.ts";
import { describeComposedRoute, describeFallbackCollision, describeRouteCollision } from "./collisions.ts";
import { analyzeNotFound, analyzeResponse, analyzeRoute, type HandlerAnalysisHost } from "./handlers.ts";
import { routePath } from "./routes.ts";

/**
 * What server composition asks of the analyzer that hosts it. The four module
 * tables are filled by `analyze` before the walk begins and read while it runs;
 * `stableAliases` is the one this file writes, because the question it answers
 * — was this `let` ever reassigned — costs a walk of the whole program and is
 * asked once per name.
 */
export interface ServerCompositionHost extends HandlerAnalysisHost {
  readonly moduleProgram: Program | null;
  readonly moduleServeCombinators: ReadonlyMap<string, {readonly imported: ServeCombinator; readonly span: Span}>;
  readonly moduleServerAliases: ReadonlyMap<string, ServerAlias>;
  readonly moduleServers: ReadonlyMap<string, NodeServerDeclaration>;
  readonly stableAliases: Map<string, boolean>;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span): void;
  isPredeclared(statement: NodeServerDeclaration): boolean;
  isTopLevelScope(): boolean;
  lookup(name: string): {readonly span: Span} | null;
}

export function analyzeServer(host: ServerCompositionHost, statement: NodeServerDeclaration): void {
  if (!host.isTopLevelScope()) {
    host.typeError("A server is a module declaration; move it to the top level", statement.span);
  }
  if (!host.isPredeclared(statement)) host.declareBinding(statement.name, false, serveAppType, statement.span);

  const routes = new Map<string, ComposedRoute>();
  const operations = new Map<string, ComposedRoute>();
  let notFound: ComposedFallback | null = null;
  let responsePolicy: NodeResponseDeclaration | null = null;
  for (const item of statement.items) {
    if (item.kind === "NodeServerSpread") {
      host.requireAssignable(host.inferExpression(item.value, serveAppType), serveAppType, item.value.span);
      const composed = composedItems(host, statement, item);
      if (!composed) continue;
      if (composed.notFound) {
        if (notFound) host.typeError(describeFallbackCollision(notFound, composed.notFound), item.span);
        else notFound = composed.notFound;
      }
      if (composed.responsePolicy) {
        if (responsePolicy) host.typeError("A server can declare only one @response policy", item.span);
        else responsePolicy = composed.responsePolicy;
      }
      for (const entry of composed.routes) recordRoute(host, entry, routes, operations, item.span);
      continue;
    }
    if (item.kind === "NodeNotFoundDeclaration") {
      const written: ComposedFallback = {fallback: item, spread: null, origin: []};
      if (notFound) host.typeError(describeFallbackCollision(notFound, written), item.span);
      else notFound = written;
      analyzeNotFound(host, item);
      continue;
    }
    if (item.kind === "NodeResponseDeclaration") {
      if (responsePolicy) host.typeError("A server can declare only one @response policy", item.span);
      else responsePolicy = item;
      analyzeResponse(host, item);
      continue;
    }
    recordRoute(host, {route: item, path: routePath(host, item), spread: null, origin: []}, routes, operations, item.pathSpan);
    analyzeRoute(host, item);
  }
}

/**
 * Enters one route into this server's shape map and compares it against every route already
 * entered, whether that route was written here or composed in by a spread. Composition is why the
 * entries carry an origin: a conflicting route the author cannot see in his own file has to name
 * the server it came from.
 */
export function recordRoute(
  host: ServerCompositionHost,
  entry: ComposedRoute,
  routes: Map<string, ComposedRoute>,
  operations: Map<string, ComposedRoute>,
  span: Span,
): void {
  if (entry.route.operationId !== null) {
    const previousOperation = operations.get(entry.route.operationId);
    if (previousOperation) {
      host.typeError(
        `Operation '${entry.route.operationId}' is declared by both ${describeComposedRoute(previousOperation)} and ${describeComposedRoute(entry)}; operation names must be unique after server composition`,
        span,
      );
    } else operations.set(entry.route.operationId, entry);
  }
  const shape = routeShape(entry.path);
  const key = `${entry.route.method} ${shape}`;
  const previous = routes.get(key);
  if (previous) {
    host.typeError(describeRouteCollision(previous, entry), span);
    return;
  }
  // SV-I4: a WebSocket upgrade is an HTTP GET on the wire, so a GET route and
  // a @websocket route at one path are one address with two owners. openapi()
  // has always refused to describe that pair; the referee that judges the
  // route table refuses it here, before a server that cannot be documented is
  // ever assembled.
  const upgradeCounterpart = entry.route.method === "WEBSOCKET" ? "GET" : entry.route.method === "GET" ? "WEBSOCKET" : null;
  if (upgradeCounterpart !== null) {
    const counterpart = routes.get(`${upgradeCounterpart} ${shape}`);
    if (counterpart) {
      host.typeError(
        `Route ${describeComposedRoute(counterpart)} and ${describeComposedRoute(entry)} share the path '${entry.path}';`
        + " an HTTP GET and a WebSocket upgrade cannot share one documented path",
        span,
      );
      return;
    }
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
    host.typeError(
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
export function composedItems(
  host: ServerCompositionHost,
  statement: NodeServerDeclaration,
  spread: NodeServerSpread,
): {readonly routes: readonly ComposedRoute[]; readonly notFound: ComposedFallback | null; readonly responsePolicy: NodeResponseDeclaration | null} | null {
  const target = resolveComposedServer(host, spread.value);
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
        const nested = resolveComposedServer(host, item.value);
        if (nested) collect(nested.server, prefix + nested.prefix, [...origin, nested.server.name]);
        continue;
      }
      if (item.kind === "NodeNotFoundDeclaration") {
        if (prefix !== "") {
          host.typeError("prefix cannot scope @notFound; compose the fallback on the final server instead", spread.span);
        } else notFound ??= {fallback: item, spread, origin};
        continue;
      }
      if (item.kind === "NodeResponseDeclaration") {
        // @response 是最终应用的全局表示策略，前缀只能改变路径，无法缩小它
        // 的作用域。静态可见时在这里拒绝，避免构建应用时才出现跨路由副作用。
        if (prefix !== "") {
          host.typeError("prefix cannot scope @response; compose the policy on the final server instead", spread.span);
        } else responsePolicy ??= item;
        continue;
      }
      // A server that conflicts with itself already reported it; one entry per shape is what
      // reaches the composing server, exactly as one entry per shape reaches its own map.
      const path = prefixedRoutePath(prefix, routePath(host, item));
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
export function resolveComposedServer(host: ServerCompositionHost, value: Expression, followed: Set<string> = new Set()): ComposedServer | null {
  if (value.kind === "CallExpression" && !value.optional) {
    if (value.callee.kind !== "IdentifierExpression") return null;
    const combinator = host.moduleServeCombinators.get(value.callee.name);
    if (!combinator || !resolvesTo(host, value.callee.name, combinator.span)) return null;
    const appIndex = combinator.imported === "prefix" ? 1 : 0;
    const app = value.arguments[appIndex];
    if (!app || value.argumentNames?.slice(0, appIndex + 1).some((argumentName) => argumentName !== null)) return null;
    const inner = resolveComposedServer(host, app, followed);
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
  const declaration = host.moduleServers.get(name);
  if (declaration) return resolvesTo(host, name, declaration.span) ? {server: declaration, prefix: ""} : null;
  const alias = host.moduleServerAliases.get(name);
  if (!alias || followed.has(name) || !resolvesTo(host, name, alias.span)) return null;
  if (alias.binding === "let" && !aliasBindingIsStable(host, alias)) return null;
  followed.add(name);
  return resolveComposedServer(host, alias.initializer, followed);
}

/** Whether a `let` alias has never been reassigned, asked once per name and program. */
export function aliasBindingIsStable(host: ServerCompositionHost, alias: ServerAlias): boolean {
  const cached = host.stableAliases.get(alias.name);
  if (cached !== undefined) return cached;
  const stable = host.moduleProgram !== null && bindingNeverReassigned(host.moduleProgram, alias.name, alias.span);
  host.stableAliases.set(alias.name, stable);
  return stable;
}

/**
 * Whether a name still reaches the declaration this module recorded for it. An import, a
 * shadowing binding, or a parameter of the same name reaches a different binding.
 */
export function resolvesTo(host: ServerCompositionHost, name: string, span: Span): boolean {
  const binding = host.lookup(name);
  return binding !== null && spanIdentity(binding.span) === spanIdentity(span);
}

/**
 * A module-level `const name = expression` or `let name = expression` binding, the indirect
 * spellings of a spread target that can still be exactly the value the initializer resolves to: a
 * bare name, or a velar/serve combinator call the resolver sees through. A `let` alias resolves
 * only after the stability predicate confirms the module never reassigns it — that check belongs
 * to the resolver, which is the point that knows the whole program. A pattern binding is excluded
 * because it never holds the whole value.
 */
export function moduleServerAlias(statement: Statement): ServerAlias | null {
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

/** A composed route's address as the runtime's `prefix` will spell it: the literal prefix, then the path. */
export function prefixedRoutePath(prefix: string, path: string): string {
  if (prefix === "") return path;
  return prefix + (path === "/" ? "" : path);
}
