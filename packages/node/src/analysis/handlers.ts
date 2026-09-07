/**
 * The three declarations a server body can carry a function in: a route, the
 * `@notFound` fallback, and the `@response` policy.
 *
 * D115 P4 R4a. Each one checks the same two things in its own vocabulary —
 * which inputs the framework supplies and what the result is allowed to be —
 * and each writes the lowering hint that lets the emitter and the OpenAPI
 * document describe what the types already decided.
 */
import { describeType, spanIdentity, unknownType, type Expression, type Span, type ValueType } from "@velarscript/compiler/extension";
import { routeParameterHint, routeResultHint, type RouteParameterKind, type RouteParameterSource } from "../contracts.ts";
import { type NodeNotFoundDeclaration, type NodeResponseDeclaration, type NodeRouteDeclaration } from "../server-ast.ts";
import { isServeRequestType, isWebSocketConnectionType, routePatternType, VELAR_HTTP_OUTCOME_IDENTITY, type NodeRouteInputType } from "../server-types.ts";
import { openApiResponseContentTypes, openApiResponseSchema, openApiResponseStatus, openApiSchema } from "./openapi.ts";
import { isNamedDataRecord, isResponsePolicyResult, isRouteResult, scalarKind } from "./response-shapes.ts";
import { boundRoutePathType, staticPattern, type RouteAnalysisHost } from "./routes.ts";

/**
 * What a handler asks of the analyzer that hosts it. The two input tables are
 * written by the contextual-default seam as the signature is read and consulted
 * here as the body is checked, so they arrive live through the host.
 */
export interface HandlerAnalysisHost extends RouteAnalysisHost {
  readonly contextualRouteParameters: ReadonlyMap<string, ValueType>;
  readonly routeInputs: ReadonlyMap<string, NodeRouteInputType>;
  analyzeFunctionDeclaration(
    statement: NodeNotFoundDeclaration | NodeResponseDeclaration | NodeRouteDeclaration,
    className: string | null,
    method: boolean,
    declareSelf: boolean,
    forceAsynchronous: boolean,
    declarationKind: string,
  ): void;
  inferExpression(expression: Expression, contextualType: ValueType): ValueType;
  inferredFunctionResult(statement: NodeNotFoundDeclaration | NodeResponseDeclaration | NodeRouteDeclaration): ValueType;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
}

export function analyzeNotFound(host: HandlerAnalysisHost, fallback: NodeNotFoundDeclaration): void {
  host.analyzeFunctionDeclaration(fallback, null, true, false, true, "Not-found fallback");
  if (fallback.parameters.length > 1) {
    host.typeError("@notFound accepts at most one Request parameter", fallback.signatureSpan);
  }
  const parameter = fallback.parameters[0];
  if (parameter) {
    if (parameter.rest) host.typeError("@notFound Request cannot be a rest parameter", parameter.span);
    if (parameter.defaultValue) host.typeError("@notFound Request is supplied by the server and cannot have a default value", parameter.span);
    if (!parameter.type) host.typeError("@notFound Request requires the explicit Request type", parameter.span);
    else {
      const resolved = host.expandAliases(host.resolveValidatedAnnotation(parameter.type));
      if (!isServeRequestType(resolved)) host.typeError(`@notFound parameter must be Request; received ${describeType(resolved)}`, parameter.span);
    }
  }
  const result = host.expandAliases(host.inferredFunctionResult(fallback));
  if (!isRouteResult(result, (identity) => host.fieldsOf(identity), new Set())) {
    host.typeError(
      `@notFound must return Data or a response from velar/serve; received ${describeType(result)}`,
      fallback.returnType?.span ?? fallback.span,
    );
  }
}

export function analyzeResponse(host: HandlerAnalysisHost, handler: NodeResponseDeclaration): void {
  host.analyzeFunctionDeclaration(handler, null, true, false, true, "Response policy");
  if (handler.parameters.length < 1 || handler.parameters.length > 2) {
    host.typeError("@response declares (outcome: HttpOutcome) or (outcome: HttpOutcome, request: Request)", handler.signatureSpan);
  }
  for (const [index, parameter] of handler.parameters.entries()) {
    if (parameter.rest) host.typeError("@response parameters cannot be rest parameters", parameter.span);
    if (parameter.defaultValue) host.typeError("@response parameters are supplied by the framework and cannot have defaults", parameter.span);
    if (!parameter.type) {
      host.typeError(`@response parameter ${index + 1} requires an explicit ${index === 0 ? "HttpOutcome" : "Request"} type`, parameter.span);
      continue;
    }
    const resolved = host.expandAliases(host.resolveValidatedAnnotation(parameter.type));
    const valid = index === 0
      ? resolved.kind === "named" && (resolved.identity === VELAR_HTTP_OUTCOME_IDENTITY || resolved.name === "HttpOutcome")
      : isServeRequestType(resolved);
    if (!valid) host.typeError(`@response parameter ${index + 1} must be ${index === 0 ? "HttpOutcome" : "Request"}; received ${describeType(resolved)}`, parameter.span);
  }
  const result = host.expandAliases(host.inferredFunctionResult(handler));
  host.extensionCalls.set(
    spanIdentity(handler.signatureSpan),
    routeResultHint(
      openApiResponseSchema(result, (identity) => host.fieldsOf(identity), new Set(), (identity, name) => host.enumWireValuesOf(identity, name)),
      openApiResponseContentTypes(result),
      null,
    ),
  );
  if (!isResponsePolicyResult(result, (identity) => host.fieldsOf(identity), new Set())) {
    host.typeError(`@response must return Data or a final response from velar/serve; received ${describeType(result)}`, handler.returnType?.span ?? handler.span);
  }
}

export function analyzeRoute(host: HandlerAnalysisHost, route: NodeRouteDeclaration): void {
  host.requireAssignable(host.inferExpression(route.pathExpression, routePatternType), routePatternType, route.pathExpression.span);
  const pattern = staticPattern(host, route);
  if (!pattern) host.typeError("A route path must be statically resolvable from p\"...\"", route.pathSpan);
  // 两种作用域模式共享同一份捕获验证与 OpenAPI 类型提示。对象模式随后把
  // 这个形状交给 route 绑定；投影模式的合成参数则分别声明每个字段。
  if (route.routeBinding === null) boundRoutePathType(host, pattern);
  host.analyzeFunctionDeclaration(route, null, true, false, true, "Route");

  let bodies = 0;
  let forms = 0;
  let requests = 0;
  let connections = 0;
  const declared = new Set<string>();
  for (const parameter of route.inputParameters) {
    if (declared.has(parameter.name)) {
      host.typeError(`Route parameter '${parameter.name}' is declared more than once`, parameter.span);
    }
    declared.add(parameter.name);
    const key = `${parameter.span.start}:${parameter.span.end}`;
    const routeInput = host.routeInputs.get(key);
    if (!parameter.type && !host.contextualRouteParameters.has(key)) {
      host.typeError(`Route parameter '${parameter.name}' requires an explicit type`, parameter.span);
      continue;
    }
    const resolved = parameter.type
      ? host.expandAliases(host.resolveValidatedAnnotation(parameter.type))
      : host.contextualRouteParameters.get(key) ?? unknownType;
    const scalar = scalarKind(resolved);
    let source: RouteParameterSource;
    let kind: RouteParameterKind;

    if (route.transport === "websocket" && isWebSocketConnectionType(resolved)) {
      source = "connection";
      kind = "connection";
      connections += 1;
      if (connections > 1) host.typeError("A @websocket route declares exactly one WebSocketConnection parameter", parameter.span);
      if (parameter.defaultValue) host.typeError("WebSocketConnection is supplied by the framework and cannot have a default value", parameter.span);
    } else if (routeInput) {
      source = routeInput.role;
      if (source === "form" || source === "upload") {
        forms += 1;
        if (route.transport === "websocket" || route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
          host.typeError(`${route.method} routes cannot declare form or upload inputs`, parameter.span);
        }
      }
      if (source === "request") {
        kind = "request";
        requests += 1;
        if (requests > 1) host.typeError("A route can declare only one Request parameter", parameter.span);
      } else if (source === "upload") kind = "upload";
      else if (source === "dependency") kind = "dependency";
      else if (source === "security") kind = "security";
      else kind = scalar ?? "data";
    } else if (isServeRequestType(resolved)) {
      source = "request";
      kind = "request";
      requests += 1;
      if (requests > 1) host.typeError("A route can declare only one Request parameter", parameter.span);
      if (parameter.defaultValue) host.typeError("A Request parameter is supplied by the server and cannot have a default value", parameter.span);
    } else if (scalar) {
      host.typeError(`Scalar route input '${parameter.name}' must be declared in the p\"...?...\" query contract or use an explicit header/cookie/security descriptor`, parameter.span);
      continue;
    } else {
      if (route.transport === "websocket") {
        host.typeError(`@websocket parameter '${parameter.name}' must be WebSocketConnection, Request, or an explicit input descriptor`, parameter.span);
        continue;
      }
      source = "body";
      kind = "data";
      bodies += 1;
      if (route.method !== "POST" && route.method !== "PUT" && route.method !== "PATCH") {
        host.typeError(`${route.method} routes do not infer a JSON body; use the route pattern query contract or an explicit Request`, parameter.span);
      }
      if (bodies > 1) host.typeError("A route can declare only one structured JSON body parameter", parameter.span);
      if (parameter.defaultValue) host.typeError("A structured JSON body parameter cannot have a default value", parameter.span);
      if (!isNamedDataRecord(resolved, (identity) => host.fieldsOf(identity), new Set())) {
        host.typeError(`A route body must be a concrete Data record type; received ${describeType(resolved)}`, parameter.span);
      }
    }
    host.extensionCalls.set(
      key,
      routeParameterHint(source, kind, openApiSchema(resolved, (identity) => host.fieldsOf(identity), new Set(), (identity, name) => host.enumWireValuesOf(identity, name)), Boolean(routeInput)),
    );
  }
  if (forms > 0 && bodies > 0) {
    host.typeError("A route cannot combine an inferred JSON body with form or upload inputs", route.span);
  }
  const result = host.expandAliases(host.inferredFunctionResult(route));
  if (route.transport === "websocket") {
    if (connections !== 1) host.typeError("A @websocket route requires exactly one WebSocketConnection parameter", route.signatureSpan);
    if (result.kind !== "null") {
      host.typeError(`@websocket must finish with null; received ${describeType(result)}`, route.returnType?.span ?? route.span);
    }
    return;
  }
  host.extensionCalls.set(
    `${route.signatureSpan.start}:${route.signatureSpan.end}`,
    routeResultHint(
      openApiResponseSchema(result, (identity) => host.fieldsOf(identity), new Set(), (identity, name) => host.enumWireValuesOf(identity, name)),
      openApiResponseContentTypes(result),
      openApiResponseStatus(result),
    ),
  );
  if (!isRouteResult(result, (identity) => host.fieldsOf(identity), new Set())) {
    host.typeError(
      `Route '${route.name}' must return Data or a response from velar/serve; received ${describeType(result)}`,
      route.returnType?.span ?? route.span,
    );
  }
}
