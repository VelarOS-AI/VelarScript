/**
 * The OpenAPI document a route's types describe.
 *
 * D115 P4 R4a. Two derivations live here: `openApiSchema` is what a value type
 * is on the wire, and the three `openApiResponse*` functions are what a
 * handler's *result* is — which is not the same question, because a response
 * envelope describes the framework and its payload describes the answer.
 */
import { type ValueType } from "@velarscript/compiler/extension";
import { type NodeResponseValueType, type OpenApiSchema } from "../contracts.ts";
import { isResponseShape } from "./response-shapes.ts";

export function openApiResponseSchema(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumWireValuesOf: (identity: string, name: string) => ReadonlyMap<string, string | number> | null,
): OpenApiSchema {
  if (type.kind === "union") {
    const schemas = type.members.map((member) => openApiResponseSchema(member, fieldsOf, seen, enumWireValuesOf));
    return schemas.length === 1 ? schemas[0]! : { anyOf: schemas };
  }
  if (type.kind === "object" && type.fields.has("status")) {
    const json = type.fields.get("json");
    if (json) return openApiSchema(json, fieldsOf, seen, enumWireValuesOf);
    if (type.fields.has("text") || type.fields.has("stream")) return { type: "string" };
  }
  const metadata = (type as NodeResponseValueType).nodeResponse;
  if (metadata?.payload) return openApiSchema(metadata.payload, fieldsOf, seen, enumWireValuesOf);
  return openApiSchema(type, fieldsOf, seen, enumWireValuesOf);
}

export function openApiResponseContentTypes(type: ValueType): readonly string[] {
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

export function openApiResponseStatus(type: ValueType): number | null {
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

/**
 * D102 ruling 1: an enum reaches OpenAPI as its wire values, which are strings
 * or safe integers. `type` is written only where every value agrees — a mixed
 * enum states its `enum` alone rather than claiming a type half its members do
 * not have — and an all-integer enum says `integer`, which is what the values
 * are and what the zod contracts this came from pin.
 */
function enumValueSchema(values: readonly (string | number)[]): OpenApiSchema {
  const textual = values.every((value) => typeof value === "string");
  const numeric = !textual && values.every((value) => typeof value === "number");
  return { ...(textual ? { type: "string" } : numeric ? { type: "integer" } : {}), enum: values };
}

export function openApiSchema(
  type: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumWireValuesOf: (identity: string, name: string) => ReadonlyMap<string, string | number> | null,
): OpenApiSchema {
  if (type.kind === "string" || type.kind === "number" || type.kind === "bool") {
    return { type: type.kind === "bool" ? "boolean" : type.kind };
  }
  if (type.kind === "null") return { type: "null" };
  if (type.kind === "enum") {
    const wireValues = enumWireValuesOf(type.identity, type.name);
    return wireValues ? enumValueSchema([...wireValues.values()]) : {type: "string"};
  }
  if (type.kind === "enumMember") {
    // D102 ruling 1's motivating shape is a record union discriminated by a
    // pinned member (`kind: Proto.v2`), and what crosses the wire is the wire
    // value — the member name was only ever right for a member that maps to
    // itself, and it is never right for one pinned to an integer.
    const wire = enumWireValuesOf(type.identity, type.name)?.get(type.member);
    return enumValueSchema([wire ?? type.member]);
  }
  if (type.kind === "unknown" || type.kind === "any") return {};
  if (type.kind === "optional") {
    return { anyOf: [openApiSchema(type.inner, fieldsOf, seen, enumWireValuesOf), { type: "null" }] };
  }
  if (type.kind === "union") {
    return { anyOf: type.members.map((member) => openApiSchema(member, fieldsOf, seen, enumWireValuesOf)) };
  }
  if (type.kind === "list" || type.kind === "set") {
    return {
      type: "array",
      items: openApiSchema(type.element, fieldsOf, seen, enumWireValuesOf),
      ...(type.kind === "set" ? { uniqueItems: true } : {}),
    };
  }
  if (type.kind === "record") {
    return { type: "object", additionalProperties: openApiSchema(type.value, fieldsOf, seen, enumWireValuesOf) };
  }
  if (type.kind === "object") return openApiObjectSchema(type.fields, fieldsOf, seen, enumWireValuesOf);
  if (type.kind === "named") {
    if (type.name === "Duration") return { type: "number" };
    const identity = type.identity ?? type.name;
    if (seen.has(identity)) return { type: "object" };
    const fields = fieldsOf(identity);
    if (!fields) return {};
    return openApiObjectSchema(fields, fieldsOf, new Set([...seen, identity]), enumWireValuesOf);
  }
  return {};
}

function openApiObjectSchema(
  fields: ReadonlyMap<string, ValueType>,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  seen: ReadonlySet<string>,
  enumWireValuesOf: (identity: string, name: string) => ReadonlyMap<string, string | number> | null,
): OpenApiSchema {
  const properties = Object.create(null) as Record<string, OpenApiSchema>;
  const required: string[] = [];
  for (const [name, field] of fields) {
    properties[name] = openApiSchema(field, fieldsOf, seen, enumWireValuesOf);
    if (field.kind !== "optional") required.push(name);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}
