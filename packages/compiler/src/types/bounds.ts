/**
 * What a type-parameter bound promises, and who is refused for not keeping it.
 *
 * The vocabulary itself — the three names and the `TypeParameterBound` type —
 * is declared in `model.ts`, because the `ValueType` union's callable kinds
 * carry `typeParameterBounds` and a union cannot import from a module that
 * imports it. Everything that *reads* the vocabulary is here: the grant table
 * (D41 item 61, D51 rule 110), the two questions asked of it, and the
 * violation collectors a generic call reports through.
 */
import { type CallableType, type TypeEnvironment, type TypeParameterBound, typeParameterBoundNames, unknownType, type ValueType } from "./model.ts";
import { substituteTypeParameters, unifyTypeParameters } from "./unification.ts";

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

/** A type argument solved for a bounded parameter that the bound rejects. */
export interface GenericBoundViolation {
  readonly index: number;
  readonly name: string;
  readonly bound: TypeParameterBound;
  readonly solved: ValueType;
}

/** Every declared bound of `actual` must be promised by `expected`'s. */
export function typeParameterBoundsAccept(actual: CallableType, expected: CallableType): boolean {
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
  return collectTypeArgumentBoundViolations(
    callable.typeParameterNames,
    callable.typeParameterBounds,
    bindings,
    satisfiesBound,
    unknownParameters,
  );
}

/**
 * D55 rule 124: the same judgment for a declaration that is not a callable —
 * `type Box<T: Data>` applied to an argument. The callable form above is now a
 * thin caller, so a bound is decided in exactly one place no matter which
 * declaration form carries it.
 */
export function collectTypeArgumentBoundViolations(
  names: readonly string[] | undefined,
  bounds: readonly (TypeParameterBound | null)[] | undefined,
  bindings: readonly (ValueType | null)[],
  satisfiesBound: (type: ValueType, bound: TypeParameterBound) => boolean,
  unknownParameters?: ReadonlySet<number>,
): readonly GenericBoundViolation[] {
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
      violations.push({ index, name: names?.[index] ?? `#${index + 1}`, bound, solved });
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
  const expandAliases = (type: ValueType): ValueType => environment.expandTypeAliases?.(type) ?? type;
  for (let index = 0; index < actual.parameters.length; index += 1) {
    const provided = expected.parameters[index] ?? expected.rest;
    if (provided) unifyTypeParameters(actual.parameters[index]!, provided, bindings, fieldsOf, unknownParameters, expandAliases);
  }
  if (actual.rest) {
    for (let index = actual.parameters.length; index < expected.parameters.length; index += 1) {
      unifyTypeParameters(actual.rest, expected.parameters[index]!, bindings, fieldsOf, unknownParameters, expandAliases);
    }
    if (expected.rest) unifyTypeParameters(actual.rest, expected.rest, bindings, fieldsOf, unknownParameters, expandAliases);
  }
  // The result position is deliberately outside the `unknown` sink: an expected
  // result of `unknown` says "the consumer accepts anything", not "the callee
  // is handed an unvalidated value". Only the input positions can force a
  // bounded parameter to be `unknown` inside the body.
  unifyTypeParameters(actual.result, expected.result, bindings, fieldsOf, undefined, expandAliases);
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
