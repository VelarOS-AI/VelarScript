/** Shared compiler/Core authority for the public diagnostic path contract. */
import { numberType, stringType, type ValueType } from "./types.ts";

export const validationPathKindIdentity = "velar/validation#enum:ValidationPathKind";
export const validationPathKindMembers = new Set(["field", "listIndex", "mapKey", "mapValue", "setElement", "recordEntry", "truncated"]);
export const validationPathKindWireValues = new Map([...validationPathKindMembers].map((kind) => [kind, kind]));
export const validationPathKindType: ValueType = {kind: "enum", name: "ValidationPathKind", identity: validationPathKindIdentity};
export const validationPathSegmentType: ValueType = {
  kind: "union",
  members: [...validationPathKindMembers].map((member): ValueType => {
    const fields = new Map<string, ValueType>([["kind", {kind: "enumMember", name: "ValidationPathKind", identity: validationPathKindIdentity, member}]]);
    if (member === "field") fields.set("name", stringType);
    else if (member !== "truncated") fields.set("index", numberType);
    return {kind: "object", fields, readonlyFields: new Set(fields.keys()), readonlyView: true};
  }),
};
export const validationPathType: ValueType = {kind: "list", element: validationPathSegmentType, readonlyView: true};
