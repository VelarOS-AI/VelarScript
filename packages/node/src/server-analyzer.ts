import {
  Analyzer,
  anyType,
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
  type Parameter,
  type Program,
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isNodeServerStatement, type NodeNotFoundDeclaration, type NodeRouteDeclaration, type NodeServerDeclaration } from "./server-ast.ts";
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
  private readonly nodeModulePath: string | null;

  constructor(context: AnalysisContext = {}, extensions: readonly CompilerAnalysisExtension[] = []) {
    super(context, extensions);
    this.nodeModulePath = context.path ?? null;
  }

  override analyze(program: Program) {
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

    const routes = new Map<string, NodeRouteDeclaration>();
    let notFound: NodeNotFoundDeclaration | null = null;
    for (const item of statement.items) {
      if (item.kind === "NodeServerSpread") {
        this.requireAssignable(this.inferExpression(item.value, serveAppType), serveAppType, item.value.span);
        continue;
      }
      if (item.kind === "NodeNotFoundDeclaration") {
        if (notFound) this.typeError("A server can declare only one @notFound fallback", item.span);
        else notFound = item;
        this.analyzeNotFound(item);
        continue;
      }
      const shape = routeShape(item.path);
      const key = `${item.method} ${shape}`;
      const previous = routes.get(key);
      if (previous) {
        this.typeError(
          `Route '${item.method} ${item.path}' conflicts with '${previous.method} ${previous.path}'; parameter names do not make two route shapes distinct`,
          item.pathSpan,
        );
      } else {
        // Two routes of one method can share a concrete path. Where one declares a literal at every
        // position the other does and more, the router's literal-beats-capture score picks it every
        // time, which is the intended precedence behind '/users/me' beside '/users/{id:string}'.
        // Where neither is more specific the winner is declaration order alone and the loser can
        // never run, so the overlap is an error. A pair whose shared path is unrealizable — a
        // '{n:number}' capture against the literal 'b' — is not an overlap.
        const segments = routeSegments(item.path);
        for (const other of routes.values()) {
          if (other.method !== item.method) continue;
          const declared = routeSegments(other.path);
          if (routeSpecificityDecides(declared, segments)) continue;
          const shared = routeSharedPath(declared, segments);
          if (shared === null) continue;
          this.typeError(
            `Route '${other.method} ${other.path}' overlaps '${item.method} ${item.path}'; both match '${shared}' and neither is more specific — narrow or remove one`,
            item.pathSpan,
          );
        }
        routes.set(key, item);
      }
      this.analyzeRoute(item);
    }
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
}

const uploadType: ValueType = { kind: "named", name: "Upload", identity: "velar/serve#type:Upload" };

export function inferNodeIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt, callbackAt, runtimeTypeAt, expandAliases } = context;
  switch (intrinsic.name) {
    case "serve.response.json": {
      arity(1, 3);
      const value = inferAt(0, anyType);
      if (argumentAt(1)) inferAt(1, numberType);
      if (argumentAt(2)) inferAt(2, optionalOf(responseHeadersType));
      return nodeResponseValue("json", value, literalStatus(argumentAt(1), 200), "application/json");
    }
    case "serve.response.created": {
      arity(1, 2);
      const value = inferAt(0, anyType);
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

function routeShape(path: string): string {
  return path.split("/").map((part) => part.startsWith("{") && part.endsWith("}") ? "{}" : part).join("/");
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
