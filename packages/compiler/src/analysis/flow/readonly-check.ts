/** A runtime shape check refines data; it cannot grant writes to an existing typed alias. */
import { isReadonlyView, optionalOf, readonlyViewOf, semanticTypeIdentity, unionOf, type ValueType } from "../../types.ts";

export interface ReadonlyCheckHost {
  expandAliases(type: ValueType): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  matchTypesOverlap(left: ValueType, right: ValueType): boolean;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
}

function slots(host: ReadonlyCheckHost, type: ValueType): ReadonlyMap<string, ValueType> | null {
  return type.kind === "object" ? type.fields
    : type.kind === "named" ? host.fieldsOf(type.identity ?? type.name) : null;
}

function readonlySlots(host: ReadonlyCheckHost, type: ValueType): ReadonlySet<string> {
  const fields = slots(host, type);
  if (isReadonlyView(type)) return new Set(fields?.keys());
  return type.kind === "object" ? type.readonlyFields ?? new Set()
    : type.kind === "named" ? host.readonlyFieldsOf(type.identity ?? type.name) ?? new Set() : new Set();
}

export function preserveCheckedReadonly(host: ReadonlyCheckHost, input: ValueType, target: ValueType, seen = new Set<string>()): ValueType {
  const source = host.expandAliases(input);
  const checked = host.expandAliases(target);
  if (source.kind === "unknown" || source.kind === "any" || source.kind === "parameter") return target;
  if (semanticTypeIdentity(source) === semanticTypeIdentity(checked)) return target;
  if (source.kind === "optional") return checked.kind === "optional"
    ? optionalOf(preserveCheckedReadonly(host, source.inner, checked.inner, seen))
    : preserveCheckedReadonly(host, source.inner, target, seen);
  if (source.kind === "union") {
    // Runtime evidence cannot tell a mutable view from a readonly alias of the same value.
    const matching = source.members.filter(member => host.matchTypesOverlap(member, checked));
    return matching.length > 0 ? unionOf(matching.map(member => preserveCheckedReadonly(host, member, target, new Set(seen)))) : target;
  }
  if (checked.kind === "optional") return source.kind === "null" ? source : preserveCheckedReadonly(host, source, checked.inner, seen);
  if (checked.kind === "union") {
    const matching = checked.members.filter(member => host.matchTypesOverlap(source, member));
    return matching.length > 0 ? unionOf(matching.map(member => preserveCheckedReadonly(host, source, member, new Set(seen)))) : target;
  }
  const key = `${semanticTypeIdentity(source)}\u0000${semanticTypeIdentity(checked)}`;
  // Recursive type declarations name the stable contract at this recurrence.
  if (seen.has(key)) return source;
  seen.add(key);
  const nested = (from: ValueType, to: ValueType): ValueType => preserveCheckedReadonly(host, from, to, new Set(seen));
  const sourceFields = slots(host, source);
  const protectedSlots = readonlySlots(host, source);
  const whole = isReadonlyView(source) || sourceFields !== null && sourceFields.size > 0 && [...sourceFields.keys()].every(name => protectedSlots.has(name));
  let result: ValueType = checked;
  // Runtime shape evidence cannot inspect effects or future results. A checked
  // signature may restrict a known contract, but cannot grant a broader one.
  if ((source.kind === "function" || source.kind === "action" || source.kind === "intrinsic")
    && (checked.kind === "function" || checked.kind === "action" || checked.kind === "intrinsic")) {
    return { ...source,
      parameters: source.parameters.map((parameter, index) => {
        const proposed = checked.parameters[index];
        return proposed && host.isAssignableHere(proposed, parameter) ? proposed : parameter;
      }),
      result: host.isAssignableHere(source.result, checked.result) ? nested(source.result, checked.result) : source.result };
  }
  if (source.kind === "promise" && checked.kind === "promise") {
    return { ...source, value: host.isAssignableHere(source.value, checked.value) ? nested(source.value, checked.value) : source.value };
  }
  if ((source.kind === "list" && checked.kind === "list") || (source.kind === "set" && checked.kind === "set")) {
    const element = nested(source.element, checked.element);
    result = { ...checked, element };
    if (!host.isAssignableHere(element, source.element)) result = readonlyViewOf(result);
  } else if (source.kind === "map" && checked.kind === "map") {
    const key = nested(source.key, checked.key);
    const value = nested(source.value, checked.value);
    result = { ...checked, key, value };
    if (!host.isAssignableHere(key, source.key) || !host.isAssignableHere(value, source.value)) result = readonlyViewOf(result);
  } else if (source.kind === "record" && checked.kind === "record") {
    const value = nested(source.value, checked.value);
    result = { ...checked, value };
    if (!host.isAssignableHere(value, source.value)) result = readonlyViewOf(result);
  } else if (checked.kind === "record" && sourceFields) {
    // A declared shape can have additional runtime properties. Keep the
    // checked value domain as well as every known field's protected view.
    result = readonlyViewOf({ ...checked, value: unionOf([
      checked.value, ...[...sourceFields.values()].map(field => nested(field, checked.value)),
    ]) });
    // Dynamic removal cannot preserve the source shape's required slots.
  } else {
    result = preserveRecord(host, source, checked, nested, whole);
  }
  return whole ? readonlyViewOf(result) : result;
}

function preserveRecord(host: ReadonlyCheckHost, source: ValueType, checked: ValueType, nested: (from: ValueType, to: ValueType) => ValueType, whole: boolean): ValueType {
  const to = slots(host, checked);
  const from = source.kind === "record" && to ? new Map([...to.keys()].map(name => [name, source.value])) : slots(host, source);
  if (!from || !to) {
    // Testing a wider shape cannot widen a writable value's original domain.
    return host.isAssignableHere(source, checked) && !host.isAssignableHere(checked, source) ? source : checked;
  }
  const protectedSlots = readonlySlots(host, source);
  const readonly = new Set(readonlySlots(host, checked));
  const fields = new Map(to);
  const optional = new Set(checked.kind === "object" ? checked.optionalFields : undefined);
  const sourceOptional = source.kind === "object" ? source.optionalFields : undefined;
  let changed = false;
  // A writable parent may replace this value. Retain source-only fields so
  // that a narrower structural projection cannot discard their requirements.
  for (const [name, value] of from) {
    if (to.has(name)) {
      if (!sourceOptional?.has(name) && optional.delete(name)) changed = true;
      continue;
    }
    fields.set(name, value);
    if (sourceOptional?.has(name)) optional.add(name);
    if (protectedSlots.has(name)) readonly.add(name);
    changed = true;
  }
  for (const [name, target] of to) {
    const origin = from.get(name);
    if (!origin) continue;
    const value = nested(origin, target);
    if (semanticTypeIdentity(value) !== semanticTypeIdentity(target)) {
      fields.set(name, value);
      changed = true;
    }
    // One field type serves both reads and writes. When the checked view
    // cannot be stored through the source contract, protect its replacement.
    if (!readonly.has(name) && ((!whole && protectedSlots.has(name)) || !host.isAssignableHere(value, origin))) {
      readonly.add(name);
      changed = true;
    }
  }
  if (!changed) return checked;
  // A structural view can retain a subset of protected slots without restricting its neighbors.
  return { kind: "object", fields, readonlyFields: readonly,
    ...(optional.size > 0 ? { optionalFields: optional } : {}) };
}
