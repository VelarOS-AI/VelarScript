/**
 * What a value is, seen as a response: the shapes `velar/serve` builds, the
 * predicates that decide whether a route may return one, and the two
 * constructors that carry a response's compile-time metadata alongside it.
 *
 * D115 P4 R4a. `Data` is the recursive half — a record whose every field is
 * itself Data — and it is asked here rather than in the analyzer because the
 * intrinsics, the handlers and the OpenAPI derivation all ask it, and one
 * question answered in three places is how three answers start to differ.
 */
import { describeType, numberType, stringType, type CompilerIntrinsicAnalysisContext, type ValueType } from "@velarscript/compiler/extension";
import { responseHeadersType, type NodeResponseValueType, type RouteParameterKind } from "../contracts.ts";
import { httpOutcomeType, VELAR_HTTP_OUTCOME_IDENTITY } from "../server-types.ts";

export function literalStatus(expression: ReturnType<CompilerIntrinsicAnalysisContext["argumentAt"]>, fallback: number): number | null {
  if (expression === null) return fallback;
  return expression.kind === "LiteralExpression" && typeof expression.value === "number"
    && Number.isSafeInteger(expression.value) && expression.value >= 200 && expression.value <= 599
    ? expression.value
    : null;
}

export function nodeResponseValue(body: "json" | "text" | "stream", value: ValueType, status: number | null, contentType: string): ValueType {
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

export function nodeOutcomeValue(value: ValueType, status: number | null): ValueType {
  // HttpOutcome 的公开字段描述框架信封，而 OpenAPI 应描述最终发给客户端的
  // 业务值。把 payload 留在编译期元数据里，生成代码时不会携带额外对象。
  return {...httpOutcomeType, nodeResponse: {status, contentType: "application/json", payload: value}} as NodeResponseValueType;
}

export function scalarKind(type: ValueType): Extract<RouteParameterKind, "string" | "number" | "bool" | "enum" | "list"> | null {
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

export function isNamedDataRecord(
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

export function isResponseShape(type: ValueType): boolean {
  if (type.kind !== "object") return false;
  return type.fields.has("status")
    && (type.fields.has("json") || type.fields.has("text") || type.fields.has("stream"));
}

export function requireResponseValue(context: CompilerIntrinsicAnalysisContext, type: ValueType, span: Parameters<CompilerIntrinsicAnalysisContext["typeError"]>[1]): void {
  const response = type.kind === "union" ? type.members.every((member) => isResponseShape(member) || isHttpOutcome(member)) : isResponseShape(type) || isHttpOutcome(type);
  if (!response) context.typeError(`Expected a ServeResponse, received ${describeType(type)}`, span);
}

function isHttpOutcome(type: ValueType): boolean {
  return type.kind === "named" && (type.identity === VELAR_HTTP_OUTCOME_IDENTITY || type.name === "HttpOutcome");
}

export function isRouteResult(
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
export function isResponsePolicyResult(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
): boolean {
  if (type.kind === "union") return type.members.every((member) => isResponsePolicyResult(member, fieldsOf, seen));
  return !isHttpOutcome(type) && (isResponseShape(type) || isData(type, fieldsOf, seen));
}
