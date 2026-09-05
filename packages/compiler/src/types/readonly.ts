/**
 * The readonly projection: `readonly List<T>` and its mutable twin.
 *
 * Three functions, one rule — a readonly view is a flag on the container kinds
 * that have one, and projecting through `optional` and `union` rebuilds the
 * wrapper rather than dropping it, so `readonly List<T>?` stays optional.
 */
import { optionalOf, unionOf, type ValueType } from "./model.ts";

export function isReadonlyView(type: ValueType): boolean {
  return (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
    || type.kind === "object" || type.kind === "named")
    && type.readonlyView === true;
}

export function readonlyViewOf(type: ValueType): ValueType {
  if (type.kind === "optional") return optionalOf(readonlyViewOf(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(readonlyViewOf));
  if (type.kind === "list" || type.kind === "set" || type.kind === "map" || type.kind === "record"
    || type.kind === "object" || type.kind === "named") {
    return type.readonlyView ? type : { ...type, readonlyView: true };
  }
  return type;
}

export function mutableViewOf(type: ValueType): ValueType {
  if (type.kind === "optional") return optionalOf(mutableViewOf(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(mutableViewOf));
  if (type.kind === "list") return { kind: "list", element: type.element };
  if (type.kind === "set") return { kind: "set", element: type.element };
  if (type.kind === "map") return { kind: "map", key: type.key, value: type.value };
  if (type.kind === "record") return { kind: "record", value: type.value };
  if (type.kind === "object") return { kind: "object", fields: type.fields, ...(type.readonlyFields ? { readonlyFields: type.readonlyFields } : {}), ...(type.optionalFields ? { optionalFields: type.optionalFields } : {}) };
  if (type.kind === "named") return { kind: "named", name: type.name, ...(type.identity ? { identity: type.identity } : {}), ...(type.application ? { application: type.application } : {}) };
  return type;
}
