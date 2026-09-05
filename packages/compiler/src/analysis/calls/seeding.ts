/**
 * D114 item ①: solving a call's remaining type parameters from the position the
 * call is written in.
 *
 * D115 §三 names `calls/seeding.ts`, and this is it: the seed is asked once,
 * after the arguments have had their say, and it reads only the expected type
 * and the class table. Nothing here touches the analyzer, so it is written as
 * two functions rather than as methods of the call inference.
 */
import {
  classApplicationType,
  isInvalidType,
  mutableViewOf,
  substituteTypeParameters,
  typeContainsParameter,
  unifyTypeParameters,
  unknownType,
  type GenericApplication,
  type ValueType,
} from "../../types.ts";
import type { ClassInfo } from "../../contracts.ts";

/**
 * D114 item ①, the ruling D77 rule 194 left open: a type parameter the
 * arguments leave open is solved from the position the call is written in.
 * The position is the one `contextualType` already carries — the same
 * channel section 8 reads to settle an empty `[]`, `Set()`, or `Map()` — so
 * "what is a contextual type" has one definition and cannot drift into
 * `const names: List<string> = []` passing while `= empty()` does not.
 *
 * Two disciplines make this seeding and never a guess:
 *
 * - It never overrides. Candidates are unified into a separate table and
 *   copied back only where the arguments solved nothing, so a disagreement
 *   between an argument and the annotation stays the ordinary mismatch the
 *   position already reported (D114 item ①), not a new diagnostic. A
 *   parameter only an `unknown` argument reached counts as reached: its
 *   bound violation is the argument's, and seeding over it would move that
 *   report to the position and change its words.
 * - It matches structurally, through `unifyTypeParameters` — the same walk
 *   an argument takes, so the shapes a type argument can be read out of are
 *   one list rather than two: a container's element, a Map's key and value,
 *   a Record's or a Promise's value, an optional's inner type, a callable's
 *   parameters and result, one generic record application's arguments
 *   against the same declaration, and so on down. A shape that walk does not
 *   pair leaves the parameter open, and phase 4 substitutes `unknown` as
 *   before.
 *
 * The `readonly` qualifier belongs to the position rather than to the type
 * argument: `readonly List<string>` seeds `T = string`, and a bare `T` in
 * result position takes the mutable spelling of the expected type, which is
 * the only one a type argument can be written with. An optional annotation
 * is read through for the same reason section 8 reads it through
 * (`contextualCollectionType` recurses on `optional`, so `const tags:
 * Set<string>? = Set()` keeps its element contract): a result that is itself
 * optional pairs with it directly, and any other result shape matches the
 * type the annotation holds.
 */
export function seedTypeParametersFromPosition(
  result: ValueType,
  bindings: (ValueType | null)[],
  unknownParameters: ReadonlySet<number>,
  contextualType: ValueType,
  fieldsOf: (identity: string) => ReadonlyMap<string, ValueType> | null,
  expandAliases: (type: ValueType) => ValueType,
  classes: ReadonlyMap<string, ClassInfo>,
): ReadonlySet<number> {
  const seeded = new Set<number>();
  const open = (parameter: Extract<ValueType, { kind: "parameter" }>): boolean =>
    bindings[parameter.index] == null && !unknownParameters.has(parameter.index);
  if (!typeContainsParameter(result, open)) return seeded;
  const expected = expandAliases(mutableViewOf(contextualType));
  // `unknown` and `any` are the two positions that say nothing about the
  // value they receive, which is why section 8 refuses to settle an empty
  // collection at either; a type argument reads them the same way.
  if (expected.kind === "unknown" || expected.kind === "any" || isInvalidType(expected)) return seeded;
  const match = (against: ValueType, pattern: ValueType = result): (ValueType | null)[] => {
    const table: (ValueType | null)[] = bindings.map(() => null);
    unifyTypeParameters(pattern, against, table, fieldsOf, undefined, expandAliases);
    return table;
  };
  let candidates = match(expected);
  if (expected.kind === "optional" && candidates.every((candidate) => candidate === null)) {
    candidates = match(expandAliases(expected.inner));
  }
  // D55 rule 120 layer two: the position may name a *base* of what the call
  // produces — `const numbers: Stack<number> = Boxes()`. The pattern matched
  // against it is then this result's own ancestor that applies the
  // declaration the position named, with the call's parameters still in it.
  if (candidates.every((candidate) => candidate === null)) {
    const ancestor = classPatternForPosition(result, expected.kind === "optional" ? expandAliases(expected.inner) : expected, classes);
    if (ancestor) candidates = match(expected.kind === "optional" ? expandAliases(expected.inner) : expected, ancestor);
  }
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || bindings[index] != null || unknownParameters.has(index)) continue;
    if (candidate.kind === "unknown" || isInvalidType(candidate)) continue;
    bindings[index] = candidate;
    seeded.add(index);
  }
  return seeded;
}

/**
 * The ancestor of a class result that applies the declaration a position
 * named, with this call's own type parameters carried through the chain. A
 * class is invariant in its arguments (D77 rule 194 item 1), so this walks
 * the *declaration* chain only — it never widens an argument.
 */
function classPatternForPosition(result: ValueType, expected: ValueType, classes: ReadonlyMap<string, ClassInfo>): ValueType | null {
  if (result.kind !== "class" || !result.application) return null;
  if (expected.kind !== "class") return null;
  const target = expected.application?.declaration ?? expected.identity ?? expected.name;
  let application: GenericApplication = result.application;
  const seen = new Set<string>();
  while (!seen.has(application.declaration)) {
    if (application.declaration === target || application.name === target) {
      return classApplicationType(application.declaration, application.name, application.arguments);
    }
    seen.add(application.declaration);
    const template = classes.get(application.declaration) ?? classes.get(application.name);
    const base = template?.baseApplication;
    if (!base) return null;
    const names = template?.typeParameterNames ?? [];
    const table = names.map((_, index) => application.arguments[index] ?? unknownType);
    application = { ...base, arguments: base.arguments.map((argument) => substituteTypeParameters(argument, table)) };
  }
  return null;
}
