/**
 * A route's path template: the one compiled pattern each route resolves to, the
 * handler signature that template dictates, and the capture hints the emitter
 * and the OpenAPI generator read back.
 *
 * D115 P4 R4a. The pattern is resolved once per route and cached, because three
 * separate questions ask for it — the contextual type of a `route` binding, the
 * collision key, and the handler's own parameters — and evaluating it three
 * times is how three answers start to differ.
 */
import { describeType, optionalOf, spanIdentity, type Span, type TypeReference, type ValueType } from "@velarscript/compiler/extension";
import { routeCaptureHint } from "../contracts.ts";
import { evaluateRoutePatternExpression, isCompiledRoutePattern, type CompiledRoutePattern, type RoutePatternCapture, type RoutePatternStaticValue } from "../route-pattern.ts";
import { type NodeRouteDeclaration } from "../server-ast.ts";
import { nodeBoundRoutePathType } from "../server-types.ts";
import { openApiSchema } from "./openapi.ts";
import { scalarKind } from "./response-shapes.ts";

/**
 * What the route-pattern rules ask of the analyzer that hosts them, and nothing
 * more. The two pattern tables arrive through the host rather than as captured
 * values because `analyze` replaces one of them per program and fills the other
 * as the walk goes, so a snapshot taken at construction would be the wrong one.
 */
export interface RouteAnalysisHost {
  readonly extensionCalls: Map<string, string>;
  readonly routePatterns: Map<string, CompiledRoutePattern>;
  readonly routePatternValues: ReadonlyMap<string, RoutePatternStaticValue>;
  enumWireValuesOf(identity: string, name: string): ReadonlyMap<string, string | number> | null;
  expandAliases(type: ValueType): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  resolveValidatedAnnotation(reference: TypeReference | null): ValueType;
  typeError(message: string, errorSpan: Span): void;
}

export function staticPattern(host: RouteAnalysisHost, route: NodeRouteDeclaration): CompiledRoutePattern | null {
  const cached = host.routePatterns.get(spanIdentity(route.span));
  if (cached) return cached;
  const value = evaluateRoutePatternExpression(route.pathExpression, host.routePatternValues);
  if (!isCompiledRoutePattern(value)) return null;
  host.routePatterns.set(spanIdentity(route.span), value);
  return value;
}

export function routePath(host: RouteAnalysisHost, route: NodeRouteDeclaration): string {
  return staticPattern(host, route)?.pathname ?? route.path;
}

/**
 * 路由模板就是处理函数的签名来源。字段类型在这里解析一次，正文随后看到
 * `path.params` 与 `path.query` 的精确只读结构；可选查询字段自然得到 `T?`。
 */
export function boundRoutePathType(host: RouteAnalysisHost, pattern: CompiledRoutePattern | null): ValueType {
  const fields = (captures: readonly RoutePatternCapture[], query: boolean): ValueType => {
    const values = new Map<string, ValueType>();
    const optionalFields = new Set<string>();
    for (const capture of captures) {
      const resolved = routeCaptureType(host, capture);
      values.set(capture.name, capture.optional ? optionalOf(resolved) : resolved);
      if (capture.optional) optionalFields.add(capture.name);
      const scalar = scalarKind(resolved);
      if (scalar && scalar !== "list") recordRouteCaptureHint(host, capture, resolved);
      if (!scalar || scalar === "list") {
        host.typeError(`Route field '${capture.name}' must be string, number, bool, or an enum; received ${describeType(resolved)}`, capture.typeSpan);
      }
      if (!query && capture.optional) host.typeError(`Path field '${capture.name}' cannot be optional`, capture.span);
    }
    return {kind: "object", fields: values, optionalFields, readonlyFields: new Set(values.keys())};
  };
  const params = fields(pattern?.path ?? [], false);
  const query = fields(pattern?.query ?? [], true);
  return nodeBoundRoutePathType(params, query);
}

export function routeCaptureType(host: RouteAnalysisHost, capture: RoutePatternCapture): ValueType {
  if (capture.resolvedType) return host.expandAliases(capture.resolvedType);
  const reference = {
    syntax: {kind: "NamedTypeSyntax", name: capture.typeName, span: capture.typeSpan} as const,
    span: capture.typeSpan,
  };
  return host.expandAliases(host.resolveValidatedAnnotation(reference));
}

export function recordRouteCaptureHint(host: RouteAnalysisHost, capture: RoutePatternCapture, resolved: ValueType): void {
  const scalar = scalarKind(resolved);
  if (!scalar || scalar === "list") return;
  host.extensionCalls.set(
    spanIdentity(capture.typeSpan),
    routeCaptureHint(scalar, openApiSchema(resolved, (identity) => host.fieldsOf(identity), new Set(), (identity, name) => host.enumWireValuesOf(identity, name))),
  );
}
