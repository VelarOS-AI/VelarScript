import type { TypeReference, TypeSyntax } from "./ast.ts";

export interface EnumInfo {
  readonly identity: string;
  readonly members: ReadonlySet<string>;
}

export type ExtensionTypeDisplay =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "constructor"; readonly prefix: string; readonly name: string }
  | {
      readonly kind: "properties";
      readonly name: string;
      readonly result: string;
      readonly hiddenOptionalProperties?: ReadonlyMap<string, string>;
    };

/**
 * A target-owned type family. Core traverses its nested types and owns stable
 * identity, while the active language extension owns semantic compatibility
 * between roles in the family (for example a framework constructor satisfying
 * a framework contract).
 */
export interface ExtensionValueType {
  readonly kind: "extension";
  readonly extensionId: string;
  readonly family: string;
  readonly role: string;
  readonly nominal?: string;
  readonly properties: ReadonlyMap<string, ValueType>;
  readonly requiredProperties: ReadonlySet<string>;
  readonly arguments: readonly ValueType[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly display: ExtensionTypeDisplay;
}

export type ValueType =
  | { readonly kind: "unknown"; readonly restricted?: boolean }
  /**
   * `textConvertible` marks the compiler-owned text-conversion domain (charter
   * section 14). It is not spellable in source: only the built-in `str`
   * declares it, so a bare `str` stays a first-class value while assignability
   * still admits exactly the conversion whitelist at every call site.
   */
  | { readonly kind: "any"; readonly textConvertible?: true }
  | { readonly kind: "null" }
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "bool" }
  | { readonly kind: "optional"; readonly inner: ValueType }
  | { readonly kind: "list"; readonly element: ValueType; readonly readonlyView?: true }
  | { readonly kind: "set"; readonly element: ValueType; readonly readonlyView?: true }
  | { readonly kind: "map"; readonly key: ValueType; readonly value: ValueType; readonly readonlyView?: true }
  | { readonly kind: "record"; readonly value: ValueType; readonly readonlyView?: true }
  | { readonly kind: "promise"; readonly value: ValueType }
  | {
      readonly kind: "object";
      readonly fields: ReadonlyMap<string, ValueType>;
      readonly readonlyFields?: ReadonlySet<string>;
      readonly optionalFields?: ReadonlySet<string>;
      readonly readonlyView?: true;
      /**
       * D51 (audit 12): a standard capability handle a target declares
       * structurally rather than as a named type — a socket, an event stream, a
       * terminal. `using` supplies the contract for capability handles (charter
       * section 16), and only a compiler extension can set this flag, so a user
       * record with a `close()` is still never auto-detected as ownable.
       */
      readonly capabilityHandle?: true;
    }
  | { readonly kind: "parameter"; readonly name: string; readonly index: number }
  | { readonly kind: "named"; readonly name: string; readonly identity?: string; readonly readonlyView?: true }
  | { readonly kind: "class"; readonly name: string; readonly identity?: string }
  | { readonly kind: "enum"; readonly name: string; readonly identity: string }
  | { readonly kind: "enumMember"; readonly name: string; readonly identity: string; readonly member: string }
  | { readonly kind: "enumObject"; readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> }
  | { readonly kind: "typeObject"; readonly name: string; readonly value?: ValueType }
  | { readonly kind: "runtimeType"; readonly value: ValueType }
  | { readonly kind: "classConstructor"; readonly name: string; readonly identity?: string }
  | ExtensionValueType
  | { readonly kind: "function"; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "action"; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "intrinsic"; readonly name: string; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "union"; readonly members: readonly ValueType[] };

export const unknownType: ValueType = { kind: "unknown" };
export const invalidType: ValueType = Object.freeze({ kind: "unknown" });
export const anyType: ValueType = { kind: "any" };
/** The declared parameter domain of the built-in `str`; see `isTextConvertibleType`. */
export const textConvertibleType: ValueType = Object.freeze({ kind: "any", textConvertible: true });
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };

/**
 * D41 item 61: the complete, closed bound vocabulary. A bound is a name the
 * compiler owns; users cannot define one, and there is no syntax for combining
 * two — D51 rule 110: not because the three form a containment chain (they do
 * not: a Web text-shaped value satisfies Text and is refused by Data), but
 * because no real function demands two at once. The grant table below is the
 * whole definition; nothing computes a relation between two bounds.
 */
export const typeParameterBoundNames = Object.freeze(["Comparable", "Text", "Data"] as const);

export type TypeParameterBound = (typeof typeParameterBoundNames)[number];

/** The capabilities a bound unlocks inside the declaring body. */
export type BoundCapability = "text" | "order" | "data";

/**
 * The 4x3 capability-grant table (D41 item 61). Every check reads this
 * constant; nothing computes a relation between two bounds, so the rule
 * "bounds have no subtyping" holds literally. The overlaps below are grants,
 * not type containment (D51 rule 110).
 */
const boundCapabilityGrants: Readonly<Record<TypeParameterBound, Readonly<Record<BoundCapability, boolean>>>> = Object.freeze({
  Data: Object.freeze({ text: false, order: false, data: true }),
  Text: Object.freeze({ text: true, order: false, data: true }),
  Comparable: Object.freeze({ text: true, order: true, data: true }),
});

export function isTypeParameterBound(name: string): name is TypeParameterBound {
  return (typeParameterBoundNames as readonly string[]).includes(name);
}

/** Reads the grant table. An unbounded parameter (`null`) grants nothing. */
export function boundGrants(bound: TypeParameterBound | null | undefined, capability: BoundCapability): boolean {
  return bound ? boundCapabilityGrants[bound][capability] : false;
}

/**
 * A callable carrying `actual` bounds may stand where `expected` bounds are
 * declared only when it demands no capability the target does not promise —
 * decided by the same grant table, one capability at a time.
 */
export function boundAccepts(actual: TypeParameterBound | null, expected: TypeParameterBound | null): boolean {
  if (actual === expected) return true;
  return (["text", "order", "data"] as const).every((capability) =>
    !boundGrants(actual, capability) || boundGrants(expected, capability));
}

export interface TypeEnvironment {
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonlyFieldsOf?(identity: string): ReadonlySet<string> | null;
  isSubclassOf(actual: string, expected: string): boolean;
  isPrimitiveType(name: string): boolean;
  isPrimitiveSubtype(actual: string, expected: string): boolean;
  isExtensionTypeAssignable?(
    actual: ExtensionValueType,
    expected: ExtensionValueType,
    assign: (actual: ValueType, expected: ValueType) => boolean,
  ): boolean | undefined;
  /** Target-owned total text forms used by f-strings and the built-in `str`. */
  extensionTextForm?(type: ValueType): boolean | undefined;
  /** Expands declared type aliases; the text-conversion domain checks the expanded shape. */
  expandTypeAliases?(type: ValueType): ValueType;
  /**
   * D41 item 61 risk 2: the declared bound of a type parameter in scope. The
   * bound deliberately lives outside the `parameter` type kind (whose identity
   * encodes only its De Bruijn index), so the environment answers it from the
   * declaration frame the annotation was resolved in.
   */
  boundOf?(type: Extract<ValueType, { kind: "parameter" }>): TypeParameterBound | null;
  /** Decides whether a solved type argument satisfies a declared bound. */
  satisfiesBound?(type: ValueType, bound: TypeParameterBound): boolean;
}

/**
 * The text-conversion whitelist (charter section 14): values whose text form is
 * total and hook-free. This is the single authority behind both the direct
 * `str(value)` / f-string check and the assignability of the `textConvertible`
 * parameter domain, so `str` used as a value cannot admit anything a direct
 * call rejects.
 */
export function isTextConvertibleType(type: ValueType, environment: TypeEnvironment): boolean {
  const expanded = environment.expandTypeAliases?.(type) ?? type;
  if (isInvalidType(expanded)) return true;
  switch (expanded.kind) {
    case "string":
    case "number":
    case "bool":
    case "null":
    case "enum":
    case "enumMember":
      return true;
    case "optional":
      return isTextConvertibleType(expanded.inner, environment);
    case "union":
      return expanded.members.every((member) => isTextConvertibleType(member, environment));
    // D41 item 61: a `Text`-bounded parameter promises every value it can hold
    // is already in this whitelist, so the body may interpolate it.
    case "parameter":
      return boundGrants(environment.boundOf?.(expanded) ?? null, "text");
    default:
      return environment.extensionTextForm?.(expanded) === true;
  }
}

export type ExtensionTypeSyntaxResolver = (
  syntax: TypeSyntax,
  resolve: (syntax: TypeSyntax) => ValueType,
) => ValueType | undefined;

export function resolveTypeReference(reference: TypeReference, extension?: ExtensionTypeSyntaxResolver): ValueType {
  return typeFromSyntax(reference.syntax, extension);
}

export function typeFromSyntax(syntax: TypeSyntax, extension?: ExtensionTypeSyntaxResolver): ValueType {
  const nested = (value: TypeSyntax): ValueType => typeFromSyntax(value, extension);
  const owned = extension?.(syntax, nested);
  if (owned) return owned;
  switch (syntax.kind) {
    case "NamedTypeSyntax":
      switch (syntax.name) {
        case "string": return stringType;
        case "number": return numberType;
        case "bool": return boolType;
        case "null": return nullType;
        case "unknown": return unknownType;
        case "any": return anyType;
        case "Promise": return { kind: "promise", value: nullType };
        case "Function": return { kind: "function", parameters: [], requiredParameters: 0, result: nullType };
        default: return { kind: "named", name: syntax.name };
      }
    case "EnumMemberTypeSyntax":
      return { kind: "enumMember", name: syntax.enumName, identity: syntax.enumName, member: syntax.member };
    case "GenericTypeSyntax": {
      const arguments_ = syntax.arguments.map(nested);
      if (syntax.name === "List") return { kind: "list", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Set") return { kind: "set", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Map") return { kind: "map", key: arguments_[0] ?? unknownType, value: arguments_[1] ?? unknownType };
      if (syntax.name === "Record") return { kind: "record", value: arguments_[0] ?? unknownType };
      if (syntax.name === "Promise") return { kind: "promise", value: arguments_[0] ?? unknownType };
      if (syntax.name === "Type") return { kind: "runtimeType", value: arguments_[0] ?? unknownType };
      if (syntax.name === "Function") {
        const result = arguments_.at(-1) ?? nullType;
        const parameters = arguments_.slice(0, -1);
        return { kind: "function", parameters, requiredParameters: parameters.length, result };
      }
      return { kind: "named", name: formatTypeSyntax(syntax) };
    }
    case "ReadonlyTypeSyntax":
      return readonlyViewOf(nested(syntax.inner));
    case "OptionalTypeSyntax":
      return optionalOf(nested(syntax.inner));
    case "UnionTypeSyntax":
      return unionOf(syntax.members.map(nested));
    case "FunctionTypeSyntax": {
      const fixed = syntax.parameters.filter((parameter) => !parameter.rest);
      const rest = syntax.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        parameters: fixed.map((parameter) => nested(parameter.type)),
        ...(fixed.some((parameter) => parameter.name) ? { parameterNames: fixed.map((parameter) => parameter.name ?? "") } : {}),
        requiredParameters: fixed.filter((parameter) => !parameter.optional).length,
        ...(rest ? { rest: nested(rest.type) } : {}),
        result: nested(syntax.result),
      };
    }
  }
}

export function formatTypeReference(reference: TypeReference): string {
  return formatTypeSyntax(reference.syntax);
}

export function formatTypeSyntax(syntax: TypeSyntax): string {
  switch (syntax.kind) {
    case "NamedTypeSyntax": return syntax.name;
    case "EnumMemberTypeSyntax": return `${syntax.enumName}.${syntax.member}`;
    case "GenericTypeSyntax": return `${syntax.name}<${syntax.arguments.map(formatTypeSyntax).join(", ")}>`;
    case "ReadonlyTypeSyntax": return `readonly ${syntax.inner.kind === "UnionTypeSyntax" || syntax.inner.kind === "FunctionTypeSyntax" ? `(${formatTypeSyntax(syntax.inner)})` : formatTypeSyntax(syntax.inner)}`;
    case "OptionalTypeSyntax": return `${syntax.inner.kind === "UnionTypeSyntax" || syntax.inner.kind === "FunctionTypeSyntax" ? `(${formatTypeSyntax(syntax.inner)})` : formatTypeSyntax(syntax.inner)}?`;
    case "UnionTypeSyntax": return syntax.members.map(formatTypeSyntax).join(" | ");
    case "FunctionTypeSyntax": return `(${syntax.parameters.map((parameter) => `${parameter.rest ? "..." : ""}${parameter.name ? `${parameter.name}${parameter.optional ? "?" : ""}: ` : ""}${formatTypeSyntax(parameter.type)}`).join(", ")}) -> ${formatTypeSyntax(syntax.result)}`;
  }
}

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
  if (type.kind === "named") return { kind: "named", name: type.name, ...(type.identity ? { identity: type.identity } : {}) };
  return type;
}

export function optionalOf(type: ValueType): ValueType {
  if (isInvalidType(type)) {
    return invalidType;
  }
  if (type.kind === "optional") {
    return type;
  }
  if (type.kind === "null") {
    return nullType;
  }
  return { kind: "optional", inner: type };
}

export function nonOptional(type: ValueType): ValueType {
  return type.kind === "optional" ? type.inner : type;
}

export function unionOf(types: readonly ValueType[]): ValueType {
  const members: ValueType[] = [];
  let nullable = false;
  const add = (type: ValueType): boolean => {
    if (isInvalidType(type)) return false;
    if (type.kind === "union") return type.members.every(add);
    if (type.kind === "optional") {
      nullable = true;
      return add(type.inner);
    }
    if (type.kind === "null") {
      nullable = true;
      return true;
    }
    if (!members.some((member) => sameType(member, type))) members.push(type);
    return true;
  };
  if (!types.every(add)) return invalidType;
  const value = members.length === 0 ? unknownType : members.length === 1 ? members[0]! : { kind: "union", members } satisfies ValueType;
  return nullable ? members.length === 0 ? nullType : optionalOf(value) : value;
}

export function mergeTypes(left: ValueType, right: ValueType): ValueType {
  if (isInvalidType(left) || isInvalidType(right)) {
    return invalidType;
  }
  if (left.kind === "unknown" && !left.restricted) {
    return right;
  }
  if (right.kind === "unknown" && !right.restricted) {
    return left;
  }
  if (sameType(left, right)) {
    return left;
  }
  if ((isReadonlyView(left) || isReadonlyView(right))
    && sameType(mutableViewOf(left), mutableViewOf(right))) {
    return readonlyViewOf(isReadonlyView(left) ? left : right);
  }
  if (left.kind === "optional" && sameType(left.inner, right)) {
    return left;
  }
  if (right.kind === "optional" && sameType(right.inner, left)) {
    return right;
  }
  if (left.kind === "null") {
    return optionalOf(right);
  }
  if (right.kind === "null") {
    return optionalOf(left);
  }
  return unionOf([left, right]);
}

export function resolvedAsyncType(type: ValueType): ValueType {
  if (type.kind === "promise") return resolvedAsyncType(type.value);
  if (type.kind === "optional") return optionalOf(resolvedAsyncType(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(resolvedAsyncType));
  return type;
}

export function sameType(left: ValueType, right: ValueType): boolean {
  return semanticTypeIdentity(left) === semanticTypeIdentity(right);
}

// Parameter labels are editor/call-site metadata, not part of the runtime
// callable domain. Override implementations may keep local names while every
// declaration still exposes its own checked named-argument surface.
export function sameTypeIgnoringCallableParameterNames(left: ValueType, right: ValueType): boolean {
  return typeIdentity(left, false) === typeIdentity(right, false);
}

function runtimeTypeValue(type: ValueType): ValueType | null {
  if (type.kind === "runtimeType") return type.value;
  if (type.kind === "typeObject") return type.value ?? { kind: "named", name: type.name };
  if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
  return null;
}

export function isAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string> = new Set()): boolean {
  if (isInvalidType(actual) || isInvalidType(expected)) {
    return true;
  }
  // The text-conversion domain is narrower than `any` and must be decided
  // before the `any` shortcut, so `str` passed as a value keeps the whitelist
  // at every indirect call site (`const c = str`, `values.map(str)`).
  if (expected.kind === "any" && expected.textConvertible) {
    return isTextConvertibleType(actual, environment);
  }
  if (actual.kind === "any" || expected.kind === "any") {
    return true;
  }
  if (expected.kind === "unknown") {
    return !expected.restricted;
  }
  if (actual.kind === "unknown") {
    return false;
  }
  if (sameType(actual, expected)) {
    return true;
  }
  const pair = `${semanticTypeIdentity(actual)}\u0000${semanticTypeIdentity(expected)}`;
  if (seen.has(pair)) return true;
  seen.add(pair);
  if (actual.kind === "union") {
    return actual.members.every((member) => isAssignable(member, expected, environment, new Set(seen)));
  }
  if (actual.kind === "optional") {
    return isAssignable(nullType, expected, environment, new Set(seen))
      && isAssignable(actual.inner, expected, environment, new Set(seen));
  }
  if (expected.kind === "optional") {
    return actual.kind === "null" || isAssignable(actual, expected.inner, environment, seen);
  }
  if (expected.kind === "union") {
    return expected.members.some((member) => isAssignable(actual, member, environment, new Set(seen)));
  }
  if (isReadonlyView(actual) && !isReadonlyView(expected)) {
    return false;
  }
  if (actual.kind === "parameter" && expected.kind === "parameter") {
    return actual.index === expected.index;
  }
  if (actual.kind === "enum" && expected.kind === "string") {
    return true;
  }
  if (actual.kind === "enumMember") {
    if (expected.kind === "enumMember") {
      return actual.identity === expected.identity && actual.member === expected.member;
    }
    if (expected.kind === "enum") return actual.identity === expected.identity;
    if (expected.kind === "string") return true;
  }
  if (expected.kind === "runtimeType") {
    const value = runtimeTypeValue(actual);
    return value !== null && isAssignable(value, expected.value, environment, seen);
  }
  if (actual.kind === "list" && expected.kind === "list") {
    if (expected.readonlyView) {
      return isAssignable(readonlyViewOf(actual.element), readonlyViewOf(expected.element), environment, new Set(seen));
    }
    return invariant(actual.element, expected.element, environment, seen);
  }
  if (actual.kind === "set" && expected.kind === "set") {
    if (expected.readonlyView) {
      return isAssignable(readonlyViewOf(actual.element), readonlyViewOf(expected.element), environment, new Set(seen));
    }
    return invariant(actual.element, expected.element, environment, seen);
  }
  if (actual.kind === "map" && expected.kind === "map") {
    if (expected.readonlyView) {
      return isAssignable(readonlyViewOf(actual.key), readonlyViewOf(expected.key), environment, new Set(seen))
        && isAssignable(readonlyViewOf(actual.value), readonlyViewOf(expected.value), environment, new Set(seen));
    }
    return invariant(actual.key, expected.key, environment, seen)
      && invariant(actual.value, expected.value, environment, seen);
  }
  if (actual.kind === "record" && expected.kind === "record") {
    if (expected.readonlyView) {
      return isAssignable(readonlyViewOf(actual.value), readonlyViewOf(expected.value), environment, new Set(seen));
    }
    return invariant(actual.value, expected.value, environment, seen);
  }
  if (actual.kind === "object" && expected.kind === "record") {
    if (expected.readonlyView) {
      return [...actual.fields.values()].every((field) => isAssignable(
        readonlyViewOf(field),
        readonlyViewOf(expected.value),
        environment,
        new Set(seen),
      ));
    }
    if (actual.readonlyFields && actual.readonlyFields.size > 0) return false;
    return [...actual.fields.values()].every((field) => invariant(field, expected.value, environment, seen));
  }
  if (actual.kind === "promise" && expected.kind === "promise") {
    return isAssignable(actual.value, expected.value, environment, seen);
  }
  if (actual.kind === "object" && expected.kind === "named") {
    if (environment.isPrimitiveType(expected.name)) return false;
    const fields = environment.fieldsOf(expected.identity ?? expected.name);
    const expectedReadonly = expected.readonlyView ? new Set(fields?.keys()) : environment.readonlyFieldsOf?.(expected.identity ?? expected.name) ?? undefined;
    return fields ? objectFieldsAssignable(actual.fields, fields, environment, seen, actual.readonlyView ? new Set(actual.fields.keys()) : actual.readonlyFields, expectedReadonly, actual.optionalFields) : false;
  }
  if (actual.kind === "named" && expected.kind === "object") {
    if (environment.isPrimitiveType(actual.name)) return false;
    const fields = environment.fieldsOf(actual.identity ?? actual.name);
    const actualReadonly = actual.readonlyView ? new Set(fields?.keys()) : environment.readonlyFieldsOf?.(actual.identity ?? actual.name) ?? undefined;
    const expectedReadonly = expected.readonlyView ? new Set(expected.fields.keys()) : expected.readonlyFields;
    return fields ? objectFieldsAssignable(fields, expected.fields, environment, seen, actualReadonly, expectedReadonly, undefined, expected.optionalFields) : false;
  }
  if (actual.kind === "named" && expected.kind === "named") {
    const actualPrimitive = environment.isPrimitiveType(actual.name);
    const expectedPrimitive = environment.isPrimitiveType(expected.name);
    if (actualPrimitive || expectedPrimitive) {
      return actualPrimitive && expectedPrimitive && environment.isPrimitiveSubtype(actual.name, expected.name);
    }
    const actualFields = environment.fieldsOf(actual.identity ?? actual.name);
    const expectedFields = environment.fieldsOf(expected.identity ?? expected.name);
    return actualFields !== null && expectedFields !== null
      ? objectFieldsAssignable(
        actualFields,
        expectedFields,
        environment,
        seen,
        actual.readonlyView ? new Set(actualFields.keys()) : environment.readonlyFieldsOf?.(actual.identity ?? actual.name) ?? undefined,
        expected.readonlyView ? new Set(expectedFields.keys()) : environment.readonlyFieldsOf?.(expected.identity ?? expected.name) ?? undefined,
      )
      : false;
  }
  if (actual.kind === "class" && expected.kind === "class") {
    return environment.isSubclassOf(actual.identity ?? actual.name, expected.identity ?? expected.name);
  }
  if (actual.kind === "object" && expected.kind === "object") {
    return objectFieldsAssignable(
      actual.fields,
      expected.fields,
      environment,
      seen,
      actual.readonlyView ? new Set(actual.fields.keys()) : actual.readonlyFields,
      expected.readonlyView ? new Set(expected.fields.keys()) : expected.readonlyFields,
      actual.optionalFields,
      expected.optionalFields,
    );
  }
  if ((actual.kind === "function" || actual.kind === "action" || actual.kind === "intrinsic") && (expected.kind === "function" || expected.kind === "action" || expected.kind === "intrinsic")) {
    const actualTypeParameters = actual.typeParameterNames?.length ?? 0;
    const expectedTypeParameters = expected.typeParameterNames?.length ?? 0;
    if (actualTypeParameters !== expectedTypeParameters) {
      if (expectedTypeParameters !== 0) return false;
      // D41 item 61 check site 2: the first-class path erases the parameters
      // silently, so an unsatisfied bound has to make the value unassignable
      // here; the analyzer wrapper turns the same fact into a directed message.
      const violations: GenericBoundViolation[] = [];
      const concrete = instantiateGenericCallable(actual, expected, environment, violations);
      return violations.length === 0 && isAssignable(concrete, expected, environment, seen);
    }
    if (actualTypeParameters > 0 && !typeParameterBoundsAccept(actual, expected)) return false;
    return callableInputsAssignable(actual, expected, environment, seen)
      && isAssignable(actual.result, expected.result, environment, seen);
  }
  if (actual.kind === "extension" && expected.kind === "extension") {
    return environment.isExtensionTypeAssignable?.(
      actual,
      expected,
      (nestedActual, nestedExpected) => isAssignable(nestedActual, nestedExpected, environment, new Set(seen)),
    ) ?? false;
  }
  return false;
}

export function semanticTypeIdentity(type: ValueType): string {
  return typeIdentity(type);
}

export const analysisTypeIdentity = semanticTypeIdentity;

function typeIdentity(type: ValueType, includeCallableParameterNames = true): string {
  const nested = (value: ValueType): string => typeIdentity(value, includeCallableParameterNames);
  switch (type.kind) {
    case "unknown":
      return identityNode("unknown", [isInvalidType(type) ? "diagnosed" : type.restricted ? "restricted" : ""]);
    case "any":
      // The text-conversion domain is a distinct contract from `any`; sharing
      // an identity would let `sameType` short-circuit the whitelist.
      return identityNode("any", [type.textConvertible ? "text" : ""]);
    case "null":
    case "string":
    case "number":
    case "bool":
      return identityNode(type.kind);
    case "class":
      return identityNode("class", [type.identity ?? type.name]);
    case "classConstructor":
      return identityNode("class-constructor", [type.identity ?? type.name]);
    case "named":
      return identityNode("named", [type.readonlyView ? "readonly" : "", type.identity ?? type.name]);
    case "parameter":
      // De Bruijn-style: the identity encodes only the index so that (T) -> T
      // and (U) -> U from any two declarations are the same type.
      return identityNode("parameter", [String(type.index)]);
    case "enum":
    case "enumMember":
    case "enumObject":
      return identityNode(type.kind, [type.identity, ...(type.kind === "enumMember" ? [type.member] : [])]);
    case "typeObject":
      return identityNode("type-object", [type.name]);
    case "runtimeType":
      return identityNode("runtime-type", [nested(type.value)]);
    case "optional":
      return identityNode("optional", [nested(type.inner)]);
    case "list":
      return identityNode("list", [type.readonlyView ? "readonly" : "", nested(type.element)]);
    case "set":
      return identityNode("set", [type.readonlyView ? "readonly" : "", nested(type.element)]);
    case "map":
      return identityNode("map", [type.readonlyView ? "readonly" : "", nested(type.key), nested(type.value)]);
    case "record":
      return identityNode("record", [type.readonlyView ? "readonly" : "", nested(type.value)]);
    case "promise":
      return identityNode("promise", [nested(type.value)]);
    case "object":
      return identityNode("object", [type.readonlyView ? "readonly" : "", ...[...type.fields]
        .map(([name, value]) => [name, nested(value)] as const)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => identityNode("field", [
          type.readonlyFields?.has(name) ? "readonly" : "",
          type.optionalFields?.has(name) ? "optional" : "",
          name,
          value,
        ]))]);
    case "function":
    case "action":
    case "intrinsic":
      return identityNode(type.kind, [
        type.kind === "intrinsic" ? type.name : "",
        type.typeParameterNames?.length ? String(type.typeParameterNames.length) : "",
        // D41 item 61 risk 1: the bound cannot live in the `parameter` kind's
        // identity without breaking its De Bruijn contract, so the callable
        // carries it — otherwise `<T: Text>(T) -> T` and `<U>(U) -> U` would
        // share one identity and assignment between them would go unchecked.
        type.typeParameterBounds?.some((bound) => bound !== null)
          ? identityNode("bounds", type.typeParameterBounds.map((bound) => bound ?? ""))
          : "",
        identityNode("parameter-names", includeCallableParameterNames ? type.parameterNames ?? [] : []),
        String(type.requiredParameters),
        identityNode("parameters", type.parameters.map(nested)),
        type.rest ? nested(type.rest) : "",
        nested(type.result),
      ]);
    case "extension":
      return identityNode("extension", [type.extensionId, type.family, type.role, type.nominal ?? "", ...[...type.properties]
        .map(([name, value]) => [name, nested(value)] as const)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => identityNode("property", [name, value])),
      identityNode("required-properties", [...type.requiredProperties].sort()),
      identityNode("arguments", type.arguments.map(nested)),
      identityNode("metadata", Object.entries(type.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => identityNode("entry", [name, value]))),
    ]);
    case "union":
      return identityNode("union", type.members.map(nested).sort());
  }
}

function identityNode(kind: string, parts: readonly string[] = []): string {
  return `${kind.length}:${kind}${parts.map((part) => `${part.length}:${part}`).join("")}`;
}

export function isInvalidType(type: ValueType): boolean {
  return type === invalidType;
}

export function describeType(type: ValueType): string {
  switch (type.kind) {
    case "any":
      return type.textConvertible ? "string | number | bool | enum | null" : "any";
    case "unknown":
    case "null":
    case "string":
    case "number":
    case "bool":
      return type.kind;
    case "optional":
      return `${["function", "action", "intrinsic", "union"].includes(type.inner.kind) ? `(${describeType(type.inner)})` : describeType(type.inner)}?`;
    case "list":
      return `${type.readonlyView ? "readonly " : ""}List<${describeType(type.element)}>`;
    case "set":
      return `${type.readonlyView ? "readonly " : ""}Set<${describeType(type.element)}>`;
    case "map":
      return `${type.readonlyView ? "readonly " : ""}Map<${describeType(type.key)}, ${describeType(type.value)}>`;
    case "record":
      return `${type.readonlyView ? "readonly " : ""}Record<${describeType(type.value)}>`;
    case "promise":
      return `Promise<${describeType(type.value)}>`;
    case "runtimeType":
      return `Type<${describeType(type.value)}>`;
    case "object":
      return `${type.readonlyView ? "readonly " : ""}{ ${[...type.fields].map(([name, value]) => `${type.readonlyFields?.has(name) ? "readonly " : ""}${name}${type.optionalFields?.has(name) ? "?" : ""}: ${describeType(value)}`).join(", ")} }`;
    case "named":
      return `${type.readonlyView ? "readonly " : ""}${type.name}`;
    case "parameter":
    case "class":
    case "enum":
      return type.name;
    case "enumMember":
      return `${type.name}.${type.member}`;
    case "typeObject":
    case "classConstructor":
      return type.name;
    case "enumObject":
      return `enum ${type.name}`;
    case "extension": {
      if (type.display.kind === "named") return type.display.name;
      if (type.display.kind === "constructor") return `${type.display.prefix} ${type.display.name}`;
      const display = type.display;
      const properties = [...type.properties]
        .filter(([name, value]) => {
          if (type.requiredProperties.has(name)) return true;
          const hidden = display.hiddenOptionalProperties?.get(name);
          return hidden === undefined || describeType(value) !== hidden;
        })
        .map(([name, value]) => `${name}${type.requiredProperties.has(name) ? "" : "?"}: ${describeType(value)}`);
      if (properties.length === 0 && type.arguments.length === 0) return display.name;
      return `${display.name}<(${properties.join(", ")}) -> ${display.result}${type.arguments.map((argument) => `, ${describeType(argument)}`).join("")}>`;
    }
    case "function":
    case "action":
    case "intrinsic":
      return `${type.kind === "action" ? "action " : ""}${type.typeParameterNames?.length ? `<${type.typeParameterNames.join(", ")}>` : ""}(${[
        ...type.parameters.map((parameter, index) => {
          const described = describeType(parameter);
          const labeled = type.parameterNames?.[index] ? `${type.parameterNames[index]}: ${described}` : described;
          return index >= type.requiredParameters
            ? `${labeled} = default`
            : labeled;
        }),
        ...(type.rest ? [`...${describeType(type.rest)}`] : []),
      ].join(", ")}) -> ${describeType(type.result)}`;
    case "union":
      return type.members.map(describeType).join(" | ");
  }
}

function invariant(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean {
  return isAssignable(actual, expected, environment, new Set(seen))
    && isAssignable(expected, actual, environment, new Set(seen));
}

type CallableType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

export function typeContainsParameter(
  type: ValueType,
  matches: (parameter: Extract<ValueType, { kind: "parameter" }>) => boolean = () => true,
): boolean {
  switch (type.kind) {
    case "parameter":
      return matches(type);
    case "optional":
      return typeContainsParameter(type.inner, matches);
    case "list":
    case "set":
      return typeContainsParameter(type.element, matches);
    case "map":
      return typeContainsParameter(type.key, matches) || typeContainsParameter(type.value, matches);
    case "record":
      return typeContainsParameter(type.value, matches);
    case "promise":
    case "runtimeType":
      return typeContainsParameter(type.value, matches);
    case "object":
      return [...type.fields.values()].some((field) => typeContainsParameter(field, matches));
    case "extension":
      return [...type.properties.values(), ...type.arguments].some((value) => typeContainsParameter(value, matches));
    case "function":
    case "action":
    case "intrinsic":
      // A generic callable owns its parameter indexes; they are not free here.
      if (type.typeParameterNames?.length) return false;
      return type.parameters.some((parameter) => typeContainsParameter(parameter, matches))
        || (type.rest ? typeContainsParameter(type.rest, matches) : false)
        || typeContainsParameter(type.result, matches);
    case "union":
      return type.members.some((member) => typeContainsParameter(member, matches));
    default:
      return false;
  }
}

// Mirrors the recursive positions that emitTypeCheck actually inspects. A
// Type<T> value carries a compiler-known checker, but the checker object itself
// has no runtime identity for T, so accepting it in one of these positions
// would otherwise emit a predicate that can never be sound.
export function typeContainsRuntimeTypeCheck(type: ValueType): boolean {
  switch (type.kind) {
    case "runtimeType":
      return true;
    case "optional":
      return typeContainsRuntimeTypeCheck(type.inner);
    case "list":
    case "set":
      return typeContainsRuntimeTypeCheck(type.element);
    case "map":
      return typeContainsRuntimeTypeCheck(type.key) || typeContainsRuntimeTypeCheck(type.value);
    case "record":
      return typeContainsRuntimeTypeCheck(type.value);
    case "object":
      return [...type.fields.values()].some(typeContainsRuntimeTypeCheck);
    case "union":
      return type.members.some(typeContainsRuntimeTypeCheck);
    default:
      // Promise and callable checks intentionally validate only their runtime
      // carrier, just as they already do for every other erased inner type.
      return false;
  }
}

export function substituteTypeParameters(type: ValueType, bindings: readonly (ValueType | null)[]): ValueType {
  switch (type.kind) {
    case "parameter":
      return bindings[type.index] ?? unknownType;
    case "optional":
      return optionalOf(substituteTypeParameters(type.inner, bindings));
    case "list":
    case "set": {
      const element = substituteTypeParameters(type.element, bindings);
      return element === type.element ? type : { ...type, element };
    }
    case "map": {
      const key = substituteTypeParameters(type.key, bindings);
      const value = substituteTypeParameters(type.value, bindings);
      return key === type.key && value === type.value ? type : { ...type, key, value };
    }
    case "record": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { ...type, value };
    }
    case "promise": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { kind: "promise", value };
    }
    case "runtimeType": {
      const value = substituteTypeParameters(type.value, bindings);
      return value === type.value ? type : { kind: "runtimeType", value };
    }
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, substituteTypeParameters(value, bindings)])) };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, substituteTypeParameters(value, bindings)])),
        arguments: type.arguments.map((argument) => substituteTypeParameters(argument, bindings)),
      };
    case "function":
    case "action":
    case "intrinsic":
      if (type.typeParameterNames?.length) return type;
      return {
        ...type,
        parameters: type.parameters.map((parameter) => substituteTypeParameters(parameter, bindings)),
        ...(type.rest ? { rest: substituteTypeParameters(type.rest, bindings) } : {}),
        result: substituteTypeParameters(type.result, bindings),
      };
    case "union":
      return unionOf(type.members.map((member) => substituteTypeParameters(member, bindings)));
    default:
      return type;
  }
}

export function bindNamedTypeParameters(type: ValueType, parameters: ReadonlyMap<string, ValueType>): ValueType {
  switch (type.kind) {
    case "named": {
      const bound = !type.identity ? parameters.get(type.name) : undefined;
      return bound ?? type;
    }
    case "optional":
      return optionalOf(bindNamedTypeParameters(type.inner, parameters));
    case "list":
    case "set": {
      const element = bindNamedTypeParameters(type.element, parameters);
      return element === type.element ? type : { ...type, element };
    }
    case "map":
      return { ...type, key: bindNamedTypeParameters(type.key, parameters), value: bindNamedTypeParameters(type.value, parameters) };
    case "record":
      return { ...type, value: bindNamedTypeParameters(type.value, parameters) };
    case "promise":
      return { kind: "promise", value: bindNamedTypeParameters(type.value, parameters) };
    case "runtimeType":
      return { kind: "runtimeType", value: bindNamedTypeParameters(type.value, parameters) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, bindNamedTypeParameters(value, parameters)])) };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, bindNamedTypeParameters(value, parameters)])),
        arguments: type.arguments.map((argument) => bindNamedTypeParameters(argument, parameters)),
      };
    case "function":
    case "action":
    case "intrinsic":
      if (type.typeParameterNames?.length) return type;
      return {
        ...type,
        parameters: type.parameters.map((parameter) => bindNamedTypeParameters(parameter, parameters)),
        ...(type.rest ? { rest: bindNamedTypeParameters(type.rest, parameters) } : {}),
        result: bindNamedTypeParameters(type.result, parameters),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => bindNamedTypeParameters(member, parameters)) };
    default:
      return type;
  }
}

/**
 * D51 item NEW-D3: `unknown` never *binds* a parameter — merging it would erase
 * every concrete actual at the other positions — but the site must still be
 * remembered. A bounded parameter that only `unknown` ever reached is solved to
 * `unknown`, which satisfies no bound; dropping the site silently let `unknown`
 * through every bound and on into the implicit-conversion the bound forbids.
 * Callers that check bounds pass this sink; the rest may ignore it.
 */
export function unifyTypeParameters(
  pattern: ValueType,
  actual: ValueType,
  bindings: (ValueType | null)[],
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null = () => null,
  unknownParameters?: Set<number>,
): void {
  unifyInto(pattern, actual, bindings, fieldsOf, unknownParameters);
}

function unifyInto(
  pattern: ValueType,
  actual: ValueType,
  bindings: (ValueType | null)[],
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  unknownParameters: Set<number> | undefined,
): void {
  const unifyTypeParameters = (nextPattern: ValueType, nextActual: ValueType): void =>
    unifyInto(nextPattern, nextActual, bindings, fieldsOf, unknownParameters);
  if (isInvalidType(actual)) return;
  if (pattern.kind === "parameter") {
    if (actual.kind === "unknown") {
      unknownParameters?.add(pattern.index);
      return;
    }
    const existing = bindings[pattern.index];
    bindings[pattern.index] = existing ? mergeTypes(existing, actual) : actual;
    return;
  }
  if (pattern.kind === "optional") {
    if (actual.kind === "null") return;
    if (actual.kind === "optional") return unifyTypeParameters(pattern.inner, actual.inner);
    if (actual.kind === "union") {
      const remaining = actual.members.filter((member) => member.kind !== "null");
      if (remaining.length === 0) return;
      return unifyTypeParameters(pattern.inner, unionOf(remaining));
    }
    return unifyTypeParameters(pattern.inner, actual);
  }
  if (pattern.kind === "union") {
    const concrete = pattern.members.filter((member) => !typeContainsParameter(member));
    const actualMembers = actual.kind === "union" ? actual.members : [actual];
    const remaining = actualMembers.filter((member) => !concrete.some((covered) => sameType(covered, member)));
    if (remaining.length === 0) return;
    for (const member of pattern.members) {
      if (typeContainsParameter(member)) unifyTypeParameters(member, unionOf(remaining));
    }
    return;
  }
  if ((pattern.kind === "list" && actual.kind === "list") || (pattern.kind === "set" && actual.kind === "set")) {
    return unifyTypeParameters(pattern.element, actual.element);
  }
  if (pattern.kind === "map" && actual.kind === "map") {
    unifyTypeParameters(pattern.key, actual.key);
    unifyTypeParameters(pattern.value, actual.value);
    return;
  }
  if (pattern.kind === "record" && actual.kind === "record") {
    return unifyTypeParameters(pattern.value, actual.value);
  }
  if (pattern.kind === "promise" && actual.kind === "promise") {
    return unifyTypeParameters(pattern.value, actual.value);
  }
  if (pattern.kind === "runtimeType") {
    const value = runtimeTypeValue(actual);
    if (value) return unifyTypeParameters(pattern.value, value);
  }
  if (pattern.kind === "object") {
    const fields = actual.kind === "object" ? actual.fields
      : actual.kind === "named" ? fieldsOf(actual.identity ?? actual.name)
        : null;
    if (!fields) return;
    for (const [name, field] of pattern.fields) {
      const provided = fields.get(name);
      if (provided) unifyTypeParameters(field, provided);
    }
    return;
  }
  if (pattern.kind === "extension" && actual.kind === "extension"
    && pattern.extensionId === actual.extensionId && pattern.family === actual.family) {
    for (const [name, property] of pattern.properties) {
      const provided = actual.properties.get(name);
      if (provided) unifyTypeParameters(property, provided);
    }
    for (let index = 0; index < pattern.arguments.length; index += 1) {
      const provided = actual.arguments[index];
      if (provided) unifyTypeParameters(pattern.arguments[index]!, provided);
    }
    return;
  }
  if ((pattern.kind === "function" || pattern.kind === "action" || pattern.kind === "intrinsic")
    && (actual.kind === "function" || actual.kind === "action" || actual.kind === "intrinsic")) {
    // A generic callable value is sealed: its parameter indexes belong to it.
    if (actual.typeParameterNames?.length) return;
    for (let index = 0; index < pattern.parameters.length; index += 1) {
      const provided = actual.parameters[index] ?? actual.rest;
      if (provided) unifyTypeParameters(pattern.parameters[index]!, provided);
    }
    if (pattern.rest && actual.rest) unifyTypeParameters(pattern.rest, actual.rest);
    unifyTypeParameters(pattern.result, actual.result);
  }
}

/** A type argument solved for a bounded parameter that the bound rejects. */
export interface GenericBoundViolation {
  readonly index: number;
  readonly name: string;
  readonly bound: TypeParameterBound;
  readonly solved: ValueType;
}

/** Every declared bound of `actual` must be promised by `expected`'s. */
function typeParameterBoundsAccept(actual: CallableType, expected: CallableType): boolean {
  const count = actual.typeParameterNames?.length ?? 0;
  for (let index = 0; index < count; index += 1) {
    if (!boundAccepts(actual.typeParameterBounds?.[index] ?? null, expected.typeParameterBounds?.[index] ?? null)) return false;
  }
  return true;
}

/**
 * Reports every solved binding its declared bound rejects. `satisfiesBound` is
 * the environment's decision procedure, so the three predicates that answer a
 * bound live in exactly one place (the analyzer).
 */
export function collectGenericBoundViolations(
  callable: CallableType,
  bindings: readonly (ValueType | null)[],
  satisfiesBound: (type: ValueType, bound: TypeParameterBound) => boolean,
  unknownParameters?: ReadonlySet<number>,
): readonly GenericBoundViolation[] {
  const bounds = callable.typeParameterBounds;
  if (!bounds?.some((bound) => bound !== null)) return [];
  const violations: GenericBoundViolation[] = [];
  for (let index = 0; index < bounds.length; index += 1) {
    const bound = bounds[index];
    if (!bound) continue;
    // A parameter no argument mentioned substitutes `unknown`, which satisfies
    // nothing; checking it would report every call that leaves a parameter
    // open. A parameter an `unknown` argument *did* reach is a different fact:
    // it is solved, and solved to the one type no bound admits (NEW-D3).
    const solved = bindings[index] ?? (unknownParameters?.has(index) ? unknownType : null);
    if (solved == null) continue;
    if (!satisfiesBound(solved, bound)) {
      violations.push({ index, name: callable.typeParameterNames?.[index] ?? `#${index + 1}`, bound, solved });
    }
  }
  return violations;
}

export function instantiateGenericCallable(
  actual: CallableType,
  expected: CallableType,
  environment: TypeEnvironment,
  violations?: GenericBoundViolation[],
): CallableType {
  const bindings: (ValueType | null)[] = Array.from({ length: actual.typeParameterNames?.length ?? 0 }, () => null);
  const unknownParameters = new Set<number>();
  const fieldsOf = (identity: string): ReadonlyMap<string, ValueType> | null => environment.fieldsOf(identity);
  for (let index = 0; index < actual.parameters.length; index += 1) {
    const provided = expected.parameters[index] ?? expected.rest;
    if (provided) unifyTypeParameters(actual.parameters[index]!, provided, bindings, fieldsOf, unknownParameters);
  }
  if (actual.rest) {
    for (let index = actual.parameters.length; index < expected.parameters.length; index += 1) {
      unifyTypeParameters(actual.rest, expected.parameters[index]!, bindings, fieldsOf, unknownParameters);
    }
    if (expected.rest) unifyTypeParameters(actual.rest, expected.rest, bindings, fieldsOf, unknownParameters);
  }
  // The result position is deliberately outside the `unknown` sink: an expected
  // result of `unknown` says "the consumer accepts anything", not "the callee
  // is handed an unvalidated value". Only the input positions can force a
  // bounded parameter to be `unknown` inside the body.
  unifyTypeParameters(actual.result, expected.result, bindings, fieldsOf);
  if (violations && environment.satisfiesBound) {
    const decide = environment.satisfiesBound.bind(environment);
    violations.push(...collectGenericBoundViolations(actual, bindings, decide, unknownParameters));
  }
  const { typeParameterNames: _erased, typeParameterBounds: _erasedBounds, ...base } = actual;
  return {
    ...base,
    parameters: actual.parameters.map((parameter) => substituteTypeParameters(parameter, bindings)),
    ...(actual.rest ? { rest: substituteTypeParameters(actual.rest, bindings) } : {}),
    result: substituteTypeParameters(actual.result, bindings),
  };
}

function callableInputsAssignable(actual: CallableType, expected: CallableType, environment: TypeEnvironment, seen: Set<string>): boolean {
  if (actual.requiredParameters > expected.requiredParameters) return false;
  if (!actual.rest && (expected.rest || actual.parameters.length < expected.parameters.length)) return false;

  for (let index = 0; index < expected.parameters.length; index += 1) {
    const accepted = actual.parameters[index] ?? actual.rest;
    if (!accepted || !isAssignable(expected.parameters[index]!, accepted, environment, new Set(seen))) return false;
  }

  if (expected.rest) {
    if (!actual.rest) return false;
    for (let index = expected.parameters.length; index < actual.parameters.length; index += 1) {
      if (!isAssignable(expected.rest, actual.parameters[index]!, environment, new Set(seen))) return false;
    }
    if (!isAssignable(expected.rest, actual.rest, environment, new Set(seen))) return false;
  }
  return true;
}

function objectFieldsAssignable(
  actual: ReadonlyMap<string, ValueType>,
  expected: ReadonlyMap<string, ValueType>,
  environment: TypeEnvironment,
  seen: Set<string>,
  actualReadonly: ReadonlySet<string> | undefined = undefined,
  expectedReadonly: ReadonlySet<string> | undefined = undefined,
  actualOptional: ReadonlySet<string> | undefined = undefined,
  expectedOptional: ReadonlySet<string> | undefined = undefined,
): boolean {
  for (const [name, expectedType] of expected) {
    const actualType = actual.get(name);
    if (!actualType) {
      if (expectedType.kind === "optional" || expectedOptional?.has(name)) continue;
      return false;
    }
    if (actualOptional?.has(name) && expectedType.kind !== "optional" && !expectedOptional?.has(name)) return false;
    if (expectedReadonly?.has(name)) {
      if (!isAssignable(actualType, expectedType, environment, new Set(seen))) return false;
    } else if (actualReadonly?.has(name) || !invariant(actualType, expectedType, environment, seen)) return false;
  }
  return true;
}

function writableFieldsAssignable(actual: ReadonlyMap<string, ValueType>, expected: ReadonlyMap<string, ValueType>, environment: TypeEnvironment, seen: Set<string>): boolean {
  return objectFieldsAssignable(actual, expected, environment, seen);
}
