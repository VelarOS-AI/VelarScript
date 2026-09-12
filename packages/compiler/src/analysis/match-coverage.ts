/**
 * Coverage: whether one pattern can match a type, whether it covers the whole
 * of it, and what a set of arms has covered between them.
 *
 * D114 R1d: split out of `./matching.ts` during the move, which came to 882
 * lines as one file — over the 800-line budget of D115 §一.1. The split is the
 * one the construct already has: `./matching.ts` walks an arm and binds its
 * names, and this file answers the yes/no questions that walk asks. The three
 * block-exit predicates live here because their only readers are those
 * questions and the arm that asks whether its facts reach past the match.
 */
import { type Expression, type MatchPattern, type MatchValue, type Statement, type TypeReference } from "../ast.ts";
import { spanIdentity } from "../source.ts";
import { anyType, nullType, semanticTypeIdentity, unionOf, type EnumInfo, type ValueType } from "../types.ts";
import { type ClassRegistry } from "./classes/registry.ts";
import { type Narrowing } from "./flow/narrowing.ts";
import { type LoweringRecorder } from "./lowering-recorder.ts";

/** Everything the match cluster asks of the analyzer that hosts it. */
export interface MatchCoverageHost {
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  readonly classRegistry: ClassRegistry;
  readonly enums: Map<string, EnumInfo>;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  inferredOrAnalyze(expression: Expression): ValueType;
  isSubclassOf(className: string, base: string): boolean;
  readonly lowering: LoweringRecorder;
  /** D114 F4: the matches (by statement start) one of whose arms was refused. */
  readonly matchesWithRefusedArm: ReadonlySet<number>;
  readonly narrowing: Narrowing;
  readonly nonFallthroughWhileStatements: Set<number>;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  resolveAnnotation(reference: TypeReference | null): ValueType;
}

export class MatchCoverageRules {
  private readonly host: MatchCoverageHost;

  constructor(host: MatchCoverageHost) {
    this.host = host;
  }

  matchPatternCoversWholeType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversWholeType(pattern.pattern, input);
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchTypePattern") {
      const checked = this.host.resolveAnnotation(pattern.type);
      return !this.runtimeTypeCheckMayExecute(input, checked) && this.runtimeTypeCovers(input, checked);
    }
    if (pattern.kind === "MatchValuePattern") {
      if (input.kind === "null") {
        return pattern.values.some((value) => value.kind === "LiteralExpression" && value.value === null);
      }
      if (input.kind === "enumMember") {
        return pattern.values.some((value) => {
          const candidate = this.host.inferredExpressionTypes.get(spanIdentity(value.span));
          return candidate?.kind === "enumMember"
            && candidate.identity === input.identity
            && candidate.member === input.member;
        });
      }
      if (input.kind === "bool") {
        const values = new Set<boolean>();
        for (const value of pattern.values) {
          if (value.kind === "LiteralExpression" && typeof value.value === "boolean") values.add(value.value);
        }
        return values.has(true) && values.has(false);
      }
      return false;
    }
    return this.matchPatternCoversType(pattern, input);
  }

  matchPatternIsIrrefutable(pattern: MatchPattern): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    return pattern.kind === "MatchAsPattern" && this.matchPatternIsIrrefutable(pattern.pattern);
  }

  matchPatternCoversType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchWildcardPattern" || pattern.kind === "MatchCapturePattern") return true;
    if (pattern.kind === "MatchAsPattern") return this.matchPatternCoversType(pattern.pattern, input);
    if (this.host.narrowing.matchPatternReflectionMayExecute(pattern, input)) return false;
    const type = this.host.expandAliases(input);
    if (type.kind === "union") return type.members.every((member) => this.matchPatternCoversType(pattern, member));
    if (pattern.kind === "MatchValuePattern") return this.matchPatternCoversWholeType(pattern, type);
    if (pattern.kind === "MatchTypePattern") {
      const checked = this.host.resolveAnnotation(pattern.type);
      return !this.runtimeTypeCheckMayExecute(type, checked) && this.runtimeTypeCovers(type, checked);
    }
    if (pattern.kind === "MatchListPattern") {
      return type.kind === "list" && pattern.rest !== null && pattern.elements.length === 0;
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    const fields = type.kind === "object"
      ? type.fields
      : type.kind === "named" ? this.host.fieldsOf(type.identity ?? type.name) : null;
    if (!fields) return false;
    return pattern.entries.every((entry) => {
      if (type.kind === "object" && type.optionalFields?.has(entry.property)) return false;
      const field = fields.get(entry.property);
      return Boolean(field && field.kind !== "optional" && this.matchPatternCoversType(entry.pattern, field));
    });
  }

  matchListCandidates(input: ValueType): ValueType[] {
    const type = this.host.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchListCandidates(member));
    if (type.kind === "optional") return this.matchListCandidates(type.inner);
    return type.kind === "list" || type.kind === "any" ? [type] : [];
  }

  matchObjectCandidates(input: ValueType): ValueType[] {
    const type = this.host.expandAliases(input);
    if (type.kind === "union") return type.members.flatMap((member) => this.matchObjectCandidates(member));
    if (type.kind === "optional") return this.matchObjectCandidates(type.inner);
    if (type.kind === "object" || type.kind === "any") return [type];
    return type.kind === "named" && this.host.fieldsOf(type.identity ?? type.name) ? [type] : [];
  }

  matchObjectField(candidate: ValueType, property: string): ValueType | null {
    if (candidate.kind === "any") return anyType;
    const fields = candidate.kind === "object"
      ? candidate.fields
      : candidate.kind === "named" ? this.host.fieldsOf(candidate.identity ?? candidate.name) : null;
    const field = fields?.get(property) ?? null;
    return field;
  }

  matchPatternMayMatchType(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternMayMatchType(pattern.pattern, input);
    if (pattern.kind !== "MatchValuePattern") return true;
    return pattern.values.some((value) => this.matchLiteralCompatible(
      this.host.expandAliases(input),
      this.host.inferredOrAnalyze(value),
    ));
  }

  matchObjectRestType(candidates: readonly ValueType[], selected: ReadonlySet<string>): ValueType {
    if (candidates.some((candidate) => candidate.kind === "any")) return anyType;
    const rests = candidates.map((candidate): ValueType => {
      const fields = candidate.kind === "object"
        ? candidate.fields
        : candidate.kind === "named" ? this.host.fieldsOf(candidate.identity ?? candidate.name) : null;
      const remaining = new Map([...(fields ?? [])].filter(([name]) => !selected.has(name)));
      const optionalFields = candidate.kind === "object"
        ? new Set([...(candidate.optionalFields ?? [])].filter((name) => !selected.has(name)))
        : new Set<string>();
      return {
        kind: "object",
        fields: remaining,
        ...(optionalFields.size > 0 ? { optionalFields } : {}),
      };
    });
    return rests.length > 0 ? unionOf(rests) : { kind: "object", fields: new Map() };
  }

  matchLiteralCompatible(matched: ValueType, literal: ValueType): boolean {
    if (matched.kind === "any") return true;
    if (matched.kind === "union") return matched.members.some((member) => this.matchLiteralCompatible(member, literal));
    if (matched.kind === "optional") {
      return literal.kind === "null" || this.matchLiteralCompatible(matched.inner, literal);
    }
    if (matched.kind === "enum") return (literal.kind === "enum" || literal.kind === "enumMember") && matched.identity === literal.identity;
    if (matched.kind === "enumMember") {
      return literal.kind === "enumMember" && matched.identity === literal.identity && matched.member === literal.member;
    }
    return matched.kind === literal.kind
      && (matched.kind === "string" || matched.kind === "number" || matched.kind === "bool" || matched.kind === "null");
  }

  matchValueKey(value: MatchValue): string {
    return value.kind === "LiteralExpression"
      ? value.value === null ? "null" : `${typeof value.value}:${String(value.value)}`
      : `path:${this.matchValueDisplay(value)}`;
  }

  // ENM-U6: diagnostics render the value the way the author spelled it —
  // never the internal typed key ("number:5") — including full dotted paths.
  matchValueDisplay(value: MatchValue): string {
    if (value.kind === "LiteralExpression") return String(value.value);
    const path = (expression: Expression): string => expression.kind === "IdentifierExpression"
      ? expression.name
      : expression.kind === "MemberExpression"
        ? `${path(expression.object)}.${expression.property}`
        : "?";
    return path(value);
  }

  /**
   * D45 rule 77: how a match over a class subject can be closed. A subclass
   * instance still satisfies its base pattern, so a base tail proves the match
   * exhaustive; an extern class check may fail at runtime, so only the wildcard
   * proves an extern subject, and a union of classes has to be covered member
   * by member.
   *
   * D114 0.28.0 B-I1: the pattern the advice names is the *bare* class. A
   * subject that names its arguments used to be dropped into the template
   * whole — `end with 'case Shape<number>:'` — and that is the one spelling
   * VEL4022 refuses, because type arguments are erased and cannot be checked.
   */
  classFallbackAdvice(subject: ValueType): string {
    if (subject.kind !== "class") return "cover every member or end with 'case _:'";
    if ((subject.identity ?? subject.name).startsWith("js:")) return "end with 'case _:'";
    return `end with 'case ${subject.application?.name ?? subject.name}:' or 'case _:'`;
  }

  matchTypesOverlap(left: ValueType, right: ValueType, seen = new Set<string>()): boolean {
    left = this.host.expandAliases(left);
    right = this.host.expandAliases(right);
    if (left.kind === "any" || right.kind === "any" || left.kind === "unknown" || right.kind === "unknown") return true;
    const key = `${semanticTypeIdentity(left)}\u0000${semanticTypeIdentity(right)}`;
    if (seen.has(key)) return true;
    seen.add(key);
    const overlap = (a: ValueType, b: ValueType): boolean => this.matchTypesOverlap(a, b, new Set(seen));
    if (left.kind === "union") return left.members.some((member) => overlap(member, right));
    if (right.kind === "union") return right.members.some((member) => overlap(left, member));
    if (left.kind === "optional") return overlap(left.inner, right) || overlap(nullType, right);
    if (right.kind === "optional") return overlap(left, right.inner) || overlap(left, nullType);
    // Empty collections inhabit both element contracts. Runtime shape checks
    // cannot distinguish readonly permissions, callable effects or future results.
    if (left.kind === right.kind && ["list", "set", "map", "record", "promise"].includes(left.kind)) return true;
    const callable = (type: ValueType): boolean => type.kind === "function" || type.kind === "action" || type.kind === "intrinsic";
    if (callable(left) && callable(right)) return true;
    const fields = (type: ValueType): ReadonlyMap<string, ValueType> | null => type.kind === "object" ? type.fields
      : type.kind === "named" ? this.host.fieldsOf(type.identity ?? type.name) : null;
    const optional = (type: ValueType, name: string, value: ValueType): boolean => value.kind === "optional"
      || type.kind === "object" && type.optionalFields?.has(name) === true;
    const leftFields = fields(left);
    const rightFields = fields(right);
    if (leftFields && rightFields) {
      for (const [name, value] of leftFields) {
        const other = rightFields.get(name);
        if (!other || optional(left, name, value) && optional(right, name, other)) continue;
        if (!overlap(value, other)) return false;
      }
      return true;
    }
    if (leftFields && right.kind === "record") return [...leftFields].every(([name, value]) => optional(left, name, value) || overlap(value, right.value));
    if (left.kind === "record" && rightFields) return [...rightFields].every(([name, value]) => optional(right, name, value) || overlap(left.value, value));
    if (this.bareGenericClassReaches(left, right)) return true;
    return this.host.isAssignableHere(left, right) || this.host.isAssignableHere(right, left);
  }

  /** C3: totality is about runtime shapes; field and container write permissions do not affect a match. */
  runtimeTypeCovers(input: ValueType, checked: ValueType, seen = new Set<string>()): boolean {
    input = this.host.expandAliases(input);
    checked = this.host.expandAliases(checked);
    if (checked.kind === "unknown" || checked.kind === "any") return true;
    if (input.kind === "unknown" || input.kind === "any") return false;
    const key = `${semanticTypeIdentity(input)}\u0000${semanticTypeIdentity(checked)}`;
    if (seen.has(key)) return true;
    seen.add(key);
    const covers = (from: ValueType, to: ValueType): boolean => this.runtimeTypeCovers(from, to, new Set(seen));
    if (input.kind === "union") return input.members.every(member => covers(member, checked));
    if (input.kind === "optional") return covers(input.inner, checked) && covers(nullType, checked);
    if (checked.kind === "optional") return input.kind === "null" || covers(input, checked.inner);
    if (input.kind === "enum" && (checked.kind === "enumMember" || checked.kind === "union")) {
      const members = this.host.enums.get(input.identity)?.members ?? this.host.enums.get(input.name)?.members;
      return members !== undefined && [...members].every(member => covers({ kind: "enumMember", name: input.name, identity: input.identity, member }, checked));
    }
    if (checked.kind === "union") return checked.members.some(member => covers(input, member));
    if ((input.kind === "list" && checked.kind === "list") || (input.kind === "set" && checked.kind === "set")) return covers(input.element, checked.element);
    if (input.kind === "map" && checked.kind === "map") return covers(input.key, checked.key) && covers(input.value, checked.value);
    if (input.kind === "record" && checked.kind === "record") return covers(input.value, checked.value);
    if (input.kind === "promise" && checked.kind === "promise") return true;
    const callable = (type: ValueType): boolean => type.kind === "function" || type.kind === "action" || type.kind === "intrinsic";
    if (callable(input) && callable(checked)) return true;
    const fields = (type: ValueType): ReadonlyMap<string, ValueType> | null => type.kind === "object" ? type.fields
      : type.kind === "named" ? this.host.fieldsOf(type.identity ?? type.name) : null;
    const actualFields = fields(input);
    const expectedFields = fields(checked);
    if (actualFields && expectedFields) {
      for (const [name, expected] of expectedFields) {
        const actual = actualFields.get(name);
        const optional = expected.kind === "optional" || checked.kind === "object" && checked.optionalFields?.has(name) === true;
        if (!actual) {
          if (optional) continue;
          return false;
        }
        if (!optional && input.kind === "object" && input.optionalFields?.has(name)) return false;
        if (!covers(actual, expected)) return false;
      }
      return true;
    }
    return this.host.isAssignableHere(input, checked);
  }

  /**
   * D114 0.28.0 B-D1: whether a *bare* generic class pattern can match a class
   * subject. D77 rule 194 item 2 admits the bare name in exactly two positions
   * — `is Stack` and `case Stack:` — because the check is `instanceof`, which
   * says nothing about the arguments; the pattern therefore stands for every
   * instantiation of that class. `is Round` was accepted on a `Shape<number>`
   * subject and `case Round:` was refused as "can never match", because
   * assignability compares the *applications*, and `Round<T> extends Shape<T>`
   * has no application until an argument is named. The relation the erased
   * check proves is between the two declarations, so that is what is asked, in
   * both directions — a subclass pattern on a base subject and a base pattern
   * on a subclass subject are the two ways one instantiation can be the other.
   *
   * An applied pattern never reaches here: VEL4022 refuses `case Round<number>:`
   * before the comparison. A bare *non-generic* class keeps the ordinary
   * assignability route, which already decides it exactly.
   */
  bareGenericClassReaches(subject: ValueType, pattern: ValueType): boolean {
    if (subject.kind !== "class" || pattern.kind !== "class" || pattern.application) return false;
    const declaration = pattern.identity ?? pattern.name;
    if (!this.host.classRegistry.classInfo(declaration)?.typeParameterNames?.length) return false;
    const family = subject.application?.declaration ?? subject.identity ?? subject.name;
    return this.host.isSubclassOf(declaration, family) || this.host.isSubclassOf(family, declaration);
  }

  runtimeTypeCheckMayExecute(input: ValueType, checkedInput: ValueType): boolean {
    const checked = this.host.expandAliases(checkedInput);
    if (checked.kind === "optional") return this.runtimeTypeCheckMayExecute(input, checked.inner);
    if (checked.kind === "union") return checked.members.some((member) => this.runtimeTypeCheckMayExecute(input, member));
    if (checked.kind === "class" && (checked.identity ?? checked.name).startsWith("js:")) return true;
    const aggregateCheck = checked.kind === "named" || checked.kind === "object" || checked.kind === "list"
      || checked.kind === "set" || checked.kind === "map" || checked.kind === "record";
    if (!aggregateCheck) return false;
    const source = this.host.expandAliases(input);
    return source.kind === "unknown" || source.kind === "any";
  }

  matchTypeFullyCovered(
    target: ValueType,
    coveredTypes: readonly ValueType[],
    coveredValues: ReadonlySet<string>,
    coveredEnumMembers: ReadonlySet<string>,
    coveredListLengths: ReadonlySet<number>,
    coveredListMinimum: number | null,
  ): boolean {
    target = this.host.expandAliases(target);
    if (coveredTypes.some((covered) => this.runtimeTypeCovers(target, covered))) return true;
    if (target.kind === "union") {
      return target.members.every((member) => this.matchTypeFullyCovered(
        member,
        coveredTypes,
        coveredValues,
        coveredEnumMembers,
        coveredListLengths,
        coveredListMinimum,
      ));
    }
    if (target.kind === "optional") {
      return this.matchTypeFullyCovered(target.inner, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum)
        && this.matchTypeFullyCovered(nullType, coveredTypes, coveredValues, coveredEnumMembers, coveredListLengths, coveredListMinimum);
    }
    if (target.kind === "enum") {
      const members = this.host.enums.get(target.identity)?.members ?? this.host.enums.get(target.name)?.members ?? new Set<string>();
      return [...members].every((member) => coveredEnumMembers.has(this.enumMemberCoverageKey(target.identity, member)));
    }
    if (target.kind === "enumMember") {
      return coveredEnumMembers.has(this.enumMemberCoverageKey(target.identity, target.member));
    }
    if (target.kind === "bool") return coveredValues.has("boolean:true") && coveredValues.has("boolean:false");
    if (target.kind === "null") return coveredValues.has("null");
    if (target.kind === "list" && coveredListMinimum !== null) {
      for (let length = 0; length < coveredListMinimum; length += 1) {
        if (!coveredListLengths.has(length)) return false;
      }
      return true;
    }
    return false;
  }

  enumMemberCoverageKey(identity: string, member: string): string {
    return `${identity}\u0000${member}`;
  }

  /** ENM-I5: enum members reached through a type pattern (parenthesized singletons, unions of them) credit member coverage. */
  creditEnumMemberCoverage(checked: ValueType, covered: Set<string>): void {
    const type = this.host.expandAliases(checked);
    if (type.kind === "enumMember") {
      covered.add(this.enumMemberCoverageKey(type.identity, type.member));
    } else if (type.kind === "enum") {
      for (const member of this.host.enums.get(type.identity)?.members ?? this.host.enums.get(type.name)?.members ?? []) {
        covered.add(this.enumMemberCoverageKey(type.identity, member));
      }
    } else if (type.kind === "optional") {
      this.creditEnumMemberCoverage(type.inner, covered);
    } else if (type.kind === "union") {
      for (const member of type.members) this.creditEnumMemberCoverage(member, covered);
    }
  }

  /** ENM-I6: the enum behind a match subject - bare or optional - that carries the exhaustiveness contract. */
  enumMatchSubject(matched: ValueType): { readonly target: Extract<ValueType, { kind: "enum" }>; readonly optional: boolean } | null {
    const expanded = this.host.expandAliases(matched);
    if (expanded.kind === "enum") return { target: expanded, optional: false };
    if (expanded.kind === "optional") {
      const inner = this.host.expandAliases(expanded.inner);
      if (inner.kind === "enum") return { target: inner, optional: true };
    }
    return null;
  }

  /** The class arms of a match subject: the type itself, or the class members of its optional/union spellings. */
  classArmsOf(expanded: ValueType): Extract<ValueType, { kind: "class" }>[] {
    if (expanded.kind === "class") return [expanded];
    if (expanded.kind === "optional") return this.classArmsOf(this.host.expandAliases(expanded.inner));
    if (expanded.kind === "union") return expanded.members.flatMap((member) => this.classArmsOf(this.host.expandAliases(member)));
    return [];
  }

  blockAlwaysReturns(statements: readonly Statement[]): boolean {
    for (const statement of statements) {
      if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement") return true;
      if (statement.kind === "WhileStatement" && this.host.nonFallthroughWhileStatements.has(statement.span.start)) return true;
      if (statement.kind === "IfStatement" && statement.elseBody
        && this.blockAlwaysReturns(statement.thenBody) && this.blockAlwaysReturns(statement.elseBody)) return true;
      // D114 F4: a match with a refused arm has no exhaustiveness verdict, so
      // it has no fall-through answer either. VEL4006 ("can finish without
      // returning") is that answer restated at the function, and the same one
      // mistake must not earn it: the author fixes the arm and asks again.
      if (statement.kind === "MatchStatement" && this.host.matchesWithRefusedArm.has(statement.span.start)) return true;
      if (statement.kind === "MatchStatement" && this.host.lowering.exhaustiveMatches.has(statement.span.start)
        && statement.cases.every((branch) => this.blockAlwaysReturns(branch.body))) return true;
      if (statement.kind === "TryStatement") {
        if (statement.finallyBody && this.blockAlwaysReturns(statement.finallyBody)) return true;
        if (this.blockAlwaysReturns(statement.tryBody)
          && (!statement.catchBody || this.blockAlwaysReturns(statement.catchBody))) return true;
      }
    }
    return false;
  }

  statementAlwaysExitsBlock(statement: Statement): boolean {
    if (statement.kind === "ReturnStatement" || statement.kind === "ThrowStatement"
      || statement.kind === "BreakStatement" || statement.kind === "ContinueStatement") return true;
    if (statement.kind === "WhileStatement" && this.host.nonFallthroughWhileStatements.has(statement.span.start)) return true;
    if (statement.kind === "IfStatement" && statement.elseBody) {
      return this.blockAlwaysExits(statement.thenBody) && this.blockAlwaysExits(statement.elseBody);
    }
    if (statement.kind === "MatchStatement" && this.host.lowering.exhaustiveMatches.has(statement.span.start)) {
      return statement.cases.every((branch) => this.blockAlwaysExits(branch.body));
    }
    if (statement.kind !== "TryStatement") return false;
    if (statement.finallyBody && this.blockAlwaysExits(statement.finallyBody)) return true;
    return this.blockAlwaysExits(statement.tryBody)
      && (!statement.catchBody || this.blockAlwaysExits(statement.catchBody));
  }

  blockAlwaysExits(statements: readonly Statement[]): boolean {
    return statements.some((statement) => this.statementAlwaysExitsBlock(statement));
  }
}
