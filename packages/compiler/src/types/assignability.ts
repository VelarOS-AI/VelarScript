/**
 * Assignability: may a value of this type stand where that type is expected?
 *
 * `isAssignable` is the memo and the coinduction guard; `decideAssignable` is
 * the rule table it consults, split into the four families a reader looks in —
 * the scalar and wrapper kinds, the collections, the nominal shapes, and the
 * callables. The text-conversion whitelist is here too, because it is one of
 * the answers the `textConvertible` parameter domain gives.
 */
import { boundGrants, type GenericBoundViolation, instantiateGenericCallable, typeParameterBoundsAccept } from "./bounds.ts";
import { type CallableType, isInvalidType, nullType, runtimeTypeValue, semanticTypeIdentity, type TypeEnvironment, type ValueType } from "./model.ts";
import { isReadonlyView, readonlyViewOf } from "./readonly.ts";

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

/**
 * `seen` is the coinduction path guard and has to stay per-branch, so it can
 * never answer a pair the current path did not open. This is the missing
 * companion: a memo of pairs that were actually DECIDED, so a structural tree
 * that reaches the same pair by several routes is answered once instead of
 * once per route (`invariant` alone asks every field twice, which is what made
 * nesting exponential).
 *
 * The discipline is conservative on both axes. A decision is recorded only
 * when it consulted no in-progress assumption — `assumedPairsConsulted` counts
 * the coinductive `true`s, and a decision taken while that counter moved holds
 * only under the path it was taken on. And the memo lives for exactly one
 * outermost question: the environment's declaration tables are still being
 * filled while a module resolves, and one synchronous question is the only
 * window in which they cannot have grown underneath a recorded verdict.
 */
const decidedAssignability = new Map<string, boolean>();
let decidedAssignabilityEnvironment: TypeEnvironment | null = null;
let assignabilityDepth = 0;
let assumedPairsConsulted = 0;

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
  const actualIdentity = semanticTypeIdentity(actual);
  const expectedIdentity = semanticTypeIdentity(expected);
  if (actualIdentity === expectedIdentity) {
    return true;
  }
  const pair = `${actualIdentity}\u0000${expectedIdentity}`;
  if (seen.has(pair)) {
    assumedPairsConsulted += 1;
    return true;
  }
  const memoized = decidedAssignabilityEnvironment === environment ? decidedAssignability.get(pair) : undefined;
  if (memoized !== undefined) return memoized;
  seen.add(pair);
  if (assignabilityDepth === 0) {
    decidedAssignability.clear();
    decidedAssignabilityEnvironment = environment;
    assumedPairsConsulted = 0;
  }
  assignabilityDepth += 1;
  const assumptionsBefore = assumedPairsConsulted;
  try {
    const decided = decideAssignable(actual, expected, environment, seen);
    if (assumedPairsConsulted === assumptionsBefore && decidedAssignabilityEnvironment === environment) {
      decidedAssignability.set(pair, decided);
    }
    return decided;
  } finally {
    assignabilityDepth -= 1;
    if (assignabilityDepth === 0) {
      decidedAssignability.clear();
      decidedAssignabilityEnvironment = null;
    }
  }
}

function decideAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean {
  const scalar = decideScalarAssignable(actual, expected, environment, seen);
  if (scalar !== undefined) return scalar;
  const collection = decideCollectionAssignable(actual, expected, environment, seen);
  if (collection !== undefined) return collection;
  const nominal = decideNominalAssignable(actual, expected, environment, seen);
  if (nominal !== undefined) return nominal;
  const callable = decideCallableAssignable(actual, expected, environment, seen);
  if (callable !== undefined) return callable;
  return false;
}

/**
 * The scalar and wrapper kinds: a union or optional on either side, the
 * readonly-view refusal, type parameters, the two enum exits, and a runtime
 * `Type<T>` value. `undefined` means no rule here applies and the next family
 * gets the pair.
 */
function decideScalarAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean | undefined {
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
  if (actual.kind === "enum" && (expected.kind === "string" || expected.kind === "number")) {
    return enumDomainWireKind(actual.identity, actual.name, environment) === expected.kind;
  }
  if (actual.kind === "enumMember") {
    if (expected.kind === "enumMember") {
      return actual.identity === expected.identity && actual.member === expected.member;
    }
    if (expected.kind === "enum") return actual.identity === expected.identity;
    if (expected.kind === "string" || expected.kind === "number") {
      return enumMemberWireKind(actual.identity, actual.name, actual.member, environment) === expected.kind;
    }
  }
  if (expected.kind === "runtimeType") {
    const value = runtimeTypeValue(actual);
    return value !== null && isAssignable(value, expected.value, environment, seen);
  }
  return undefined;
}

/**
 * The collections: List, Set, Map and Record are invariant in their element
 * types unless the expected side is a readonly view, which is where the
 * covariant read-only projection is admitted instead. A record literal
 * standing as a `Record<V>` is checked here for the same reason.
 */
function decideCollectionAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean | undefined {
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
  return undefined;
}

/**
 * The nominal and structural shapes: a record literal against a declared
 * record, either direction, two declared records, two classes, and two record
 * literals. Every one of them ends in `objectFieldsAssignable`, which is where
 * the readonly and optional field tables are reconciled.
 */
function decideNominalAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean | undefined {
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
  return undefined;
}

/**
 * The callables and extension-owned types: arity and parameter contravariance
 * through `callableInputsAssignable`, the generic erasure path that has to
 * prove the bounds at the same time, and the target's own answer for a type
 * Core does not own.
 */
function decideCallableAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean | undefined {
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
  return undefined;
}

/**
 * D42 item 65 gave the enum domain one one-way exit — to `string` — for the
 * single reason that an enum member *is* a string at run time, so a wire value
 * can be sent out. D102 ruling 1 keeps the exit and makes it tell the truth:
 * it now leads to whichever scalar the member's declared wire value actually
 * is. A member pinned to an integer exits to `number`; a member with no
 * explicit value still exits to `string`, because its wire value is its name.
 *
 * The whole enum exits only where every member agrees — an enum that mixes the
 * two kinds has no single scalar to be, so the author narrows to a member
 * first. An environment that cannot answer keeps the pre-D102 reading, which is
 * the correct answer for every enum that predates the ruling.
 */
function enumDomainWireKind(identity: string, name: string, environment: TypeEnvironment): "string" | "number" | "mixed" {
  const wireValues = environment.enumWireValuesOf?.(identity, name);
  if (!wireValues || wireValues.size === 0) return "string";
  let sawString = false;
  let sawNumber = false;
  for (const value of wireValues.values()) {
    if (typeof value === "number") sawNumber = true;
    else sawString = true;
  }
  return sawNumber && sawString ? "mixed" : sawNumber ? "number" : "string";
}

function enumMemberWireKind(identity: string, name: string, member: string, environment: TypeEnvironment): "string" | "number" {
  const value = environment.enumWireValuesOf?.(identity, name)?.get(member);
  return typeof value === "number" ? "number" : "string";
}

function invariant(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean {
  return isAssignable(actual, expected, environment, new Set(seen))
    && isAssignable(expected, actual, environment, new Set(seen));
}

/**
 * D114 S3b item B: a function that declares fewer parameters than its contract
 * passes is assignable to that contract. Extra arguments are ignored — the rule
 * JavaScript has and the rule a direct call already honours, since
 * `values.filter(v => v > 1)` compiles against a `(value, index)` predicate. The
 * only arity a source may not survive is one it *requires* and the contract does
 * not guarantee, which the required-count comparison refuses: a
 * `(a: number, b: string) -> bool` needing `b` stays unassignable to a
 * `(a: number) -> bool` that never passes it.
 */
function callableInputsAssignable(actual: CallableType, expected: CallableType, environment: TypeEnvironment, seen: Set<string>): boolean {
  if (actual.requiredParameters > expected.requiredParameters) return false;

  for (let index = 0; index < expected.parameters.length; index += 1) {
    const accepted = actual.parameters[index] ?? actual.rest;
    // Every later position is undeclared too, so the source ignores the rest.
    if (!accepted) break;
    if (!isAssignable(expected.parameters[index]!, accepted, environment, new Set(seen))) return false;
  }

  if (expected.rest) {
    for (let index = expected.parameters.length; index < actual.parameters.length; index += 1) {
      if (!isAssignable(expected.rest, actual.parameters[index]!, environment, new Set(seen))) return false;
    }
    if (actual.rest && !isAssignable(expected.rest, actual.rest, environment, new Set(seen))) return false;
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
