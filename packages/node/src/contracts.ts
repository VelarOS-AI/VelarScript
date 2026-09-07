/**
 * The Node analysis contracts: the shapes a route, a fallback and a composed
 * server are carried in, and the lowering hints the analyzer writes for the
 * emitter and the OpenAPI generator to read back.
 *
 * D115 P4 R4a, the shape `packages/compiler/src/contracts.ts` already has: a
 * collaborator under `analysis/` names one of these types without importing the
 * analyzer, and the emitter parses a hint without importing it either. The six
 * codecs are the whole of that protocol — one encoder and one decoder per hint
 * — and each decoder answers `null` for a value it does not own, so a hint that
 * changes shape is read as absent rather than as something else.
 */
import { stringType, type Expression, type Span, type ValueType } from "@velarscript/compiler/extension";
import { type NodeNotFoundDeclaration, type NodeRouteDeclaration, type NodeServerDeclaration, type NodeServerSpread } from "./server-ast.ts";

const routeHintPrefix = "node.route-param:";
const routeResultHintPrefix = "node.route-result:";
const routeCaptureHintPrefix = "node.route-capture:";
export const responseHeadersType: ValueType = {kind: "map", key: stringType, value: stringType};
/**
 * A route or fallback as this server sees it: written here (`spread` null, empty origin) or composed
 * in by a spread, in which case `origin` names the servers from the spread expression inward to the
 * one that declares it.
 */
export type ComposedRoute = {readonly route: NodeRouteDeclaration; readonly path: string; readonly spread: NodeServerSpread | null; readonly origin: readonly string[]};
export type ComposedFallback = {readonly fallback: NodeNotFoundDeclaration; readonly spread: NodeServerSpread | null; readonly origin: readonly string[]};
/**
 * A module-level `const name = expression` or never-reassigned `let name = expression` binding
 * whose initializer can still resolve to a server: another name, or a combinator call around one.
 */
export type ServerAlias = {readonly name: string; readonly initializer: Expression; readonly binding: "const" | "let"; readonly span: Span};
/** The velar/serve combinators whose result carries its app argument's paths through, or translated. */
export type ServeCombinator = "prefix" | "use" | "bodyLimit" | "docs" | "lifecycle";
export const serveCombinators: ReadonlySet<string> = new Set<ServeCombinator>(["prefix", "use", "bodyLimit", "docs", "lifecycle"]);
/** A spread target the analyzer resolved: the declaring server, seen through zero or more literal prefixes. */
export type ComposedServer = {readonly server: NodeServerDeclaration; readonly prefix: string};

export type NodeResponseMetadata = {readonly status: number | null; readonly contentType: string; readonly payload?: ValueType};
export type NodeResponseValueType = ValueType & {readonly nodeResponse?: NodeResponseMetadata};

export type RouteParameterSource = "body" | "request" | "header" | "cookie" | "form" | "upload" | "dependency" | "security" | "connection";
export type RouteParameterKind = "string" | "number" | "bool" | "enum" | "list" | "data" | "request" | "upload" | "dependency" | "security" | "connection";
export type OpenApiSchema = Readonly<Record<string, unknown>>;

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
