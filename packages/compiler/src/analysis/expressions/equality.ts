/**
 * When two values may be compared, and what to say when they may not: the
 * intersection `==` requires, the runtime order `<` requires, the enum wire
 * domains a comparison meets in, the NaN warning, and the membership probes
 * every collection reads back through.
 *
 * D115 §三: this was twenty-six private methods of `Analyzer`, reached from
 * `inferBinary`, from a comparison chain, from `is`, from a collection probe
 * and from `equals`. They answer one question in several spellings — can these
 * two domains ever meet — so one file owns the answer and every caller reads it
 * through `EqualityRules`.
 */
import { type Expression } from "../../ast.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type TypeParameterBound,
  type ValueType,
  boundGrants,
  describeType,
  isInvalidType,
  nullType,
} from "../../types.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type Binding, type MemberNarrowing } from "../scopes.ts";

/** D102 ruling 1: the two wire-value domains an enum can exit to. */
const STRING_WIRE_KIND: ReadonlySet<"string" | "number"> = new Set(["string"]);

const NUMBER_WIRE_KIND: ReadonlySet<"string" | "number"> = new Set(["number"]);

/** What the equality, ordering and enum-domain rules asks of the analyzer that hosts it, and nothing more. */
export interface EqualityRulesHost {
  boundOf(type: Extract<ValueType, { kind: "parameter" }>): TypeParameterBound | null;
  enumTargetOfValidatorObject(object: Expression): Extract<ValueType, { kind: "enum" }> | null;
  enumWireValuesOf(identity: string, name: string): ReadonlyMap<string, string | number> | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  lookup(name: string): Binding | null;
  lookupMemberNarrowingEntry(path: string): MemberNarrowing | null;
  readonly lowering: LoweringRecorder;
  readonlyDataViewOf(type: ValueType): ValueType;
  resolveNamedClasses(type: ValueType): ValueType;
  stableMemberAccessPath(expression: Expression): string | null;
  readonly testExpectOperands: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class EqualityRules {
  private readonly host: EqualityRulesHost;

  constructor(host: EqualityRulesHost) {
    this.host = host;
  }

  // D42 item 64: `==`/`!=` require the operand types to intersect. Strict
  // equality between two types that no single value inhabits is constant, so
  // the tightening converts a silent logic bug into a compile error. Runtime
  // lowering is untouched — this is purely static.
  requireIntersectingEquality(
    leftType: ValueType,
    rightType: ValueType,
    operator: string,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    // D44 rule 71: an assignment-established fact refines reads, but it never
    // turns a later test into a constant — `const x: string? = "a"` followed
    // by `x == null` is still the declared question about string?, not a
    // rejected string-versus-null comparison. Checked (condition) facts keep
    // participating: re-testing something the flow just proved stays an error.
    const left = this.assignedFactDomain(leftExpression, leftType);
    const right = this.assignedFactDomain(rightExpression, rightType);
    // The equality itself re-asks the question at runtime and is total over
    // its domain, so an assigned-fact operand must not carry a read guard —
    // the guard would throw on the stale value the test is there to detect.
    if (left !== leftType) this.host.lowering.runtimeNarrowings.delete(spanIdentity(leftExpression.span));
    if (right !== rightType) this.host.lowering.runtimeNarrowings.delete(spanIdentity(rightExpression.span));
    if (this.equalityTypesIntersect(left, right)) return;
    const errorSpan = { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) };
    // When only the enum/string veto separated the operands, the comparison is
    // not constant — an enum member and a raw string can match wire text at
    // runtime. That silent match is exactly the read path around `Enum.parse`
    // the veto exists to close, so the message names the boundary instead of
    // claiming a constant result (ENM-I2).
    if (this.typesIntersect(left, right, false)) {
      this.host.typeError(
        `${describeType(left)} and ${describeType(right)} can meet only where an enum member matches a raw ${this.enumMeetDomain(left, right)},`
          + ` and the enum and ${this.enumMeetDomain(left, right)} domains never meet in '${operator}'${this.equalityGuidance(left, right)}`,
        errorSpan,
      );
      return;
    }
    const constant = operator === "==" ? "false" : "true";
    this.host.typeError(
      `${describeType(left)} and ${describeType(right)} have no values in common, so '${operator}' is always ${constant}${this.equalityGuidance(left, right)}`,
      errorSpan,
    );
  }

  // COL-I3 first half: collection `==` is reference identity (the runtime
  // follows the mother language), so a freshly constructed literal operand
  // can never be identical to anything — the comparison is provably constant,
  // which is D42's own reason to reject it. Content comparison has a spelling
  // now: equals(a, b).
  rejectFreshCollectionEquality(left: Expression, right: Expression, operator: string): boolean {
    const fresh = this.freshCollectionOperand(left) ?? this.freshCollectionOperand(right);
    if (!fresh) return false;
    const constant = operator === "==" ? "false" : "true";
    this.host.typeError(
      `A ${fresh.description} built inside the comparison is a new object, and '${operator}' compares collection identity, so the result is always ${constant}; compare contents with equals(a, b)`,
      fresh.span,
    );
    return true;
  }

  private freshCollectionOperand(expression: Expression): { readonly description: string; readonly span: Span } | null {
    if (expression.kind === "ListExpression") return { description: "List literal", span: expression.span };
    if (expression.kind === "ObjectExpression") return { description: "record literal", span: expression.span };
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set")
      && !this.host.lookup(expression.callee.name)) {
      return { description: `${expression.callee.name}(...) construction`, span: expression.span };
    }
    return null;
  }

  // ENM-I3: the membership vocabulary — `in`, `has`, `index`, `count`,
  // `remove`, and the Map.get key — asks the question `==` asks, one element
  // at a time, so the probe carries the same intersection requirement and
  // the same enum/string boundary as D42 item 64.
  requireMembershipIntersection(probe: ValueType, domain: ValueType, span: Span, operation: string): boolean {
    if (isInvalidType(probe) || isInvalidType(domain)) return false;
    if (this.equalityTypesIntersect(probe, domain)) return false;
    this.host.typeError(
      this.typesIntersect(probe, domain, false)
        ? `${describeType(probe)} can match ${describeType(domain)} only as an enum member against a raw string, and the enum and string domains never meet in '${operation}'${this.equalityGuidance(probe, domain)}`
        : `${describeType(probe)} and ${describeType(domain)} have no values in common, so '${operation}' can never match${this.equalityGuidance(probe, domain)}`,
      span,
    );
    return true;
  }

  // COL-I3 second half: the same ruling that rejects a freshly built literal
  // as an `==` operand governs the membership vocabulary, because a membership
  // test asks the `==` question one element at a time. A literal written
  // inside the probe is a new object no element can be identical to, so the
  // answer is provable from the literal alone.
  //
  // Only the probe side is closed, deliberately. The container side is an
  // ordinary spelling — `x in [1, 2, 3]` builds the fresh List as the domain,
  // not as the question — and `Set.add`, `Set<Record>` and `Map<Record, V>`
  // are left alone for the same reason: an identity-keyed container of records
  // is a legitimate program (adding the same object twice, holding a record as
  // an identity token), so a diagnostic there would refuse correct code. A
  // false positive on a correct program is worse than silence; the probe is
  // the one position where the always-false answer is provable.
  rejectFreshCollectionProbe(probe: Expression, operation: string, probes: "element" | "key"): boolean {
    const fresh = this.freshCollectionOperand(probe);
    if (!fresh) return false;
    this.host.typeError(
      `A ${fresh.description} built inside the probe is a new object, and '${operation}' compares ${probes} identity, so it can never match; ${probes === "key"
        ? "hold the key in a binding and probe with that binding, or compare contents with equals(a, b)"
        : "compare contents with equals(a, b) — 'values.some(item => equals(item, probe))' asks the same question one element at a time"}`,
      fresh.span,
    );
    return true;
  }

  // ENM-I1: `is` / `is not` between statically disjoint enum domains is the
  // last equality surface that could launder one enum's member into another
  // (`==` and `case` already reject). The test is constant only when both
  // sides live purely in the enum/null domain; any string, unknown, or other
  // arm makes the runtime check a real validation and keeps it legal.
  rejectDisjointEnumTest(subjectSource: ValueType, checked: ValueType, operator: "is" | "is not", span: Span): void {
    const subjectArms = this.pureEnumDomainArms(subjectSource);
    const checkedArms = this.pureEnumDomainArms(checked);
    if (!subjectArms || !checkedArms) return;
    if (!subjectArms.some((arm) => arm.kind !== "null") || !checkedArms.some((arm) => arm.kind !== "null")) return;
    const meets = subjectArms.some((subjectArm) => checkedArms.some((checkedArm) =>
      subjectArm.kind === "null"
        ? checkedArm.kind === "null"
        : checkedArm.kind !== "null" && this.equalityTypesIntersect(subjectArm, checkedArm)));
    if (meets) return;
    const constant = operator === "is" ? "false" : "true";
    this.host.typeError(
      `${describeType(subjectSource)} and ${describeType(checked)} have no values in common, so '${operator}' is always ${constant}`,
      span,
    );
  }

  /** The enum/null arms of a type, or null when any arm falls outside that domain. */
  private pureEnumDomainArms(source: ValueType): Extract<ValueType, { kind: "enum" | "enumMember" | "null" }>[] | null {
    const arms: Extract<ValueType, { kind: "enum" | "enumMember" | "null" }>[] = [];
    const visit = (current: ValueType): boolean => {
      const type = this.host.resolveNamedClasses(this.host.expandAliases(current));
      if (type.kind === "enum" || type.kind === "enumMember" || type.kind === "null") {
        arms.push(type);
        return true;
      }
      if (type.kind === "optional") return visit(type.inner) && visit(nullType);
      if (type.kind === "union") return type.members.every(visit);
      return false;
    };
    return visit(source) ? arms : null;
  }

  // ENM-I1's call spelling: `B.is(value)` — the stored-validator form charter
  // section 6 blesses — must agree with the `is` operator, so a probe that is
  // statically another enum's member is rejected the same way.
  rejectDisjointEnumValidatorProbe(calleeExpression: Expression, arguments_: readonly Expression[]): void {
    if (calleeExpression.kind !== "MemberExpression" || calleeExpression.property !== "is" || arguments_.length !== 1) return;
    const target = this.host.enumTargetOfValidatorObject(calleeExpression.object);
    if (!target) return;
    const argument = arguments_[0]!;
    if (argument.kind === "SpreadExpression") return;
    const probe = this.host.inferredExpressionTypes.get(spanIdentity(argument.span));
    if (!probe) return;
    this.rejectDisjointEnumTest(probe, target, "is", argument.span);
  }

  /**
   * D59 rule 141 settled that `toBe` *is* `==` ("toBe 必须用语言自己的 `==`")
   * and rule 141.1 settled that `toContain` *is* `values.has(item)`. The
   * runtime half of both landed; the compile-time half did not travel with
   * them, so `expect([1]).toBe([1])` compiled and failed at run time with
   * both operands rendering byte-identically, while `[1] == [1]` is refused
   * where it is written. This runs the operator's own two gates on the
   * matcher: D42 item 64's intersection requirement, and COL-I3's rejection
   * of a freshly built literal in an identity comparison.
   *
   * `toBe` and `toEqual` deliberately part company on the fresh-literal gate.
   * `toBe` asks the `==` question, where a new object can never be identical
   * to anything, so the literal proves the answer. `toEqual` asks the
   * `equals(a, b)` question, where a fresh literal is the normal and correct
   * spelling of the expected value — rejecting it there would refuse the very
   * repair the `toBe` message teaches. The intersection gate has no such
   * split: two types with no values in common never deeply equal either.
   *
   * `toHaveLength` and `toMatch` are left alone. Neither takes a comparand:
   * `toHaveLength` takes a count, and `toMatch` takes a regular-expression
   * pattern whose relation to the subject is matching, not equality.
   */
  checkTestMatcherComparand(calleeExpression: Expression, arguments_: readonly Expression[]): void {
    if (calleeExpression.kind !== "MemberExpression" || arguments_.length !== 1) return;
    const matcher = calleeExpression.property;
    if (matcher !== "toBe" && matcher !== "toEqual" && matcher !== "toContain") return;
    const receiver = calleeExpression.object;
    if (receiver.kind !== "CallExpression") return;
    const operand = this.host.testExpectOperands.get(spanIdentity(receiver.span));
    if (operand === undefined) return;
    const argument = arguments_[0]!;
    if (argument.kind === "SpreadExpression") return;
    const probe = this.host.inferredExpressionTypes.get(spanIdentity(argument.span));
    if (!probe) return;
    // `==` leaves through `inferBinary`'s invalid-type exit before either of
    // these gates runs, so the matcher that inherits the gates leaves there
    // too: an operand the compiler already refused has been named once, and
    // the always-false reading of a program that does not yet type-check is
    // not a second mistake to report.
    if (isInvalidType(operand) || isInvalidType(probe)) return;
    if (matcher === "toContain") {
      // The membership vocabulary's own pair (ENM-I3 and COL-I3's second
      // half), asked one element at a time. Only a List receiver compares
      // element identity; text containment is code-point containment, and a
      // dynamic receiver proves nothing about which of the two it will be.
      if (operand.kind !== "list") return;
      const contained = this.host.readonlyDataViewOf(operand.element);
      if (!this.requireMembershipIntersection(probe, contained, argument.span, matcher)) {
        this.rejectFreshCollectionProbe(argument, matcher, "element");
      }
      return;
    }
    if (this.requireMembershipIntersection(probe, operand, argument.span, matcher)) return;
    if (matcher !== "toBe") return;
    // Either side settles it: `expect([1]).toBe(list)` is as constant as
    // `expect(list).toBe([1])`, exactly as `==` treats its two operands.
    const actualExpression = receiver.arguments[0];
    const fresh = this.freshCollectionOperand(argument)
      ?? (actualExpression && actualExpression.kind !== "SpreadExpression" ? this.freshCollectionOperand(actualExpression) : null);
    if (!fresh) return;
    this.host.typeError(
      `A ${fresh.description} built inside the expectation is a new object, and 'toBe' compares collection identity, so it can never match; compare contents with 'toEqual(expected)'`,
      fresh.span,
    );
  }

  // ENM-D1: an enum member is a bare wire value at runtime, so a Set element or
  // Map key type whose union mixes members of different enums — or an enum
  // with the scalar its own wire values are — would collapse nominally distinct
  // keys into one slot. The same no-intersection principle as D42 item 64,
  // applied where the collection would silently unify what the type system
  // keeps apart. D102 ruling 1: the scalar to watch for follows the wire value,
  // so `Map<Proto | number, T>` collides exactly as `Map<Kind | string, T>`
  // does, and a string-backed enum beside `number` collides with neither.
  rejectCollidingKeyDomain(keySource: ValueType, span: Span, position: string): void {
    const enumIdentities = new Set<string>();
    let enumName: string | null = null;
    const enumScalars = new Set<"string" | "number">();
    const scalars = new Set<"string" | "number">();
    const visit = (source: ValueType): void => {
      const type = this.host.expandAliases(source);
      if (type.kind === "enum" || type.kind === "enumMember") {
        enumIdentities.add(type.identity);
        enumName ??= type.name;
        for (const kind of this.enumWireScalarKinds(type)) enumScalars.add(kind);
      } else if (type.kind === "string" || type.kind === "number") {
        scalars.add(type.kind);
      } else if (type.kind === "optional") {
        visit(type.inner);
      } else if (type.kind === "union") {
        for (const member of type.members) visit(member);
      }
    };
    visit(keySource);
    const collidingScalar = [...scalars].find((kind) => enumScalars.has(kind)) ?? null;
    if (enumIdentities.size === 0 || (enumIdentities.size === 1 && collidingScalar === null)) return;
    const collision = collidingScalar !== null
      ? `mixes ${enumName ?? "an enum"} with ${collidingScalar}, and an enum member is a bare ${collidingScalar} at runtime`
      : "mixes members of different enums, which are bare wire values at runtime";
    // The deliberate spelling is the enum's own exit, and only the string one
    // has a function to name: an integer wire value leaves through assignment.
    const deliberate = collidingScalar === "number"
      ? "or bind each member to a number first and store that deliberately"
      : "or store wire strings deliberately with str(member)";
    this.host.typeError(
      `A ${position} of ${describeType(keySource)} ${collision}, so nominally distinct keys would collapse into one slot; keep the domains in separate collections, ${deliberate}`,
      span,
    );
  }

  /**
   * The declared domain behind an assignment-established fact: what a test
   * (`== null`, `??`) judges, and what an unannotated alias declares. Returns
   * the inferred type unchanged when the expression's narrowing came from a
   * check (or from nothing).
   */
  assignedFactDomain(expression: Expression, inferred: ValueType): ValueType {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.host.lookup(expression.name);
      if (binding && binding.narrowingFrame !== null && binding.assignedFact === true) {
        return (binding.storageBinding ?? binding).storageType;
      }
      return inferred;
    }
    if (expression.kind === "MemberExpression") {
      const path = this.host.stableMemberAccessPath(expression);
      const narrowing = path ? this.host.lookupMemberNarrowingEntry(path) : null;
      if (narrowing?.assigned === true && narrowing.domain) return narrowing.domain;
    }
    return inferred;
  }

  // Intersection is decided by assignability in either direction, never by
  // name, so structurally identical records declared in different modules
  // still compare. Aliases, optionals, and unions are opened first so a
  // partial overlap (`(string | number) == string`) is enough.
  equalityTypesIntersect(leftSource: ValueType, rightSource: ValueType): boolean {
    return this.typesIntersect(leftSource, rightSource, true);
  }

  typesIntersect(leftSource: ValueType, rightSource: ValueType, enumStringVeto: boolean): boolean {
    const left = this.host.resolveNamedClasses(this.host.expandAliases(leftSource));
    const right = this.host.resolveNamedClasses(this.host.expandAliases(rightSource));
    if (isInvalidType(left) || isInvalidType(right)) return true;
    // Unchecked boundary values and unresolved type parameters carry no domain
    // this rule could contradict, so they keep their existing freedom.
    if (left.kind === "any" || right.kind === "any") return true;
    if (left.kind === "unknown" || right.kind === "unknown") return true;
    if (left.kind === "parameter" || right.kind === "parameter") return true;
    // D42 item 65's one documented exception to "assignability decides
    // intersection": enum -> `string` assignability is a one-way exit that
    // exists so a wire value can be sent out. Equality is symmetric, so
    // honoring it here would open a read path around `Enum.parse` and undo
    // charter section 6's promise that an open string never silently becomes
    // an enum member. The veto runs before union arms distribute (ENM-I2):
    // a `Status | string` operand still puts a raw string and an enum member
    // into the same comparison, so the two domains never meet — not even
    // through a union arm — and the author narrows first.
    // D102 ruling 1: the exit now leads to whichever scalar the wire value is,
    // so the veto follows it there. `code == Proto.v2` against a bare number is
    // the same mistake as `text == Kind.textDelta` against a bare string, and
    // an enum that pins integers would otherwise be the one enum an open value
    // could walk into unchallenged.
    if (enumStringVeto) {
      const leftEnum = this.valueLevelEnum(left);
      if (leftEnum !== null && this.hasValueLevelScalar(right, this.enumWireScalarKinds(leftEnum))) return false;
      const rightEnum = this.valueLevelEnum(right);
      if (rightEnum !== null && this.hasValueLevelScalar(left, this.enumWireScalarKinds(rightEnum))) return false;
    }
    if (left.kind === "union") return left.members.some((member) => this.typesIntersect(member, right, enumStringVeto));
    if (right.kind === "union") return right.members.some((member) => this.typesIntersect(left, member, enumStringVeto));
    if (left.kind === "optional") {
      return this.typesIntersect(left.inner, right, enumStringVeto) || this.typesIntersect(nullType, right, enumStringVeto);
    }
    if (right.kind === "optional") {
      return this.typesIntersect(left, right.inner, enumStringVeto) || this.typesIntersect(left, nullType, enumStringVeto);
    }
    return this.host.isAssignableHere(left, right) || this.host.isAssignableHere(right, left);
  }

  equalityGuidance(leftSource: ValueType, rightSource: ValueType): string {
    const left = this.host.resolveNamedClasses(this.host.expandAliases(leftSource));
    const right = this.host.resolveNamedClasses(this.host.expandAliases(rightSource));
    const leftEnum = this.valueLevelEnum(left);
    const rightEnum = this.valueLevelEnum(right);
    const enumSide = leftEnum ?? rightEnum;
    // A union operand that mixes the enum domain with raw strings has no
    // deliberate comparison to teach until the author knows which domain the
    // value is in, so the way out is narrowing first (ENM-I2).
    const enumKinds = enumSide === null ? STRING_WIRE_KIND : this.enumWireScalarKinds(enumSide);
    const mixedUnion = (leftEnum !== null && this.hasValueLevelScalar(left, this.enumWireScalarKinds(leftEnum))) ? leftEnum
      : (rightEnum !== null && this.hasValueLevelScalar(right, this.enumWireScalarKinds(rightEnum))) ? rightEnum
        : null;
    if (mixedUnion !== null) {
      return `; narrow the union first — 'if value is ${mixedUnion.name}:' — and compare inside the branch`;
    }
    // The rejection itself needs an exact enum-versus-string pair, but the
    // guidance is worth giving whenever one side can hold a bare string and
    // the other an enum member — that is the mistake, wrapped or not.
    // MIG-1: both spellings are honest, but they behave differently on an
    // unknown value — parse throws, str compares — so the message states the
    // choosing rule instead of ranking one first. Recommending parse alone
    // broke a forward-compatible protocol handler in the referee migration:
    // it compiled clean and then threw on the first unknown wire tag.
    if (enumSide !== null && this.hasValueLevelScalar(leftEnum === null ? left : right, enumKinds)) {
      const member = enumSide.kind === "enumMember" ? `${enumSide.name}.${enumSide.member}` : `${enumSide.name}.member`;
      // D102 ruling 1: a member pinned to an integer exits to `number`, and the
      // way back is `parse` there too. The escape half differs because the
      // numeric exit is plain assignability — there is no `str` to name — so it
      // says what to write instead of naming a conversion that does not exist.
      if (!enumKinds.has("string")) {
        return `; an enum member converts to number only as a one-way wire exit, so choose by what an unknown value means here:`
          + ` write ${enumSide.name}.parse(value) == ${member} when the value must name a member — ${enumSide.name}.parse throws on anything else —`
          + ` or bind ${member} to a number first and compare that, when unknown values are expected and must be ignored, as on an open wire protocol`;
      }
      return `; an enum member converts to string only as a one-way wire exit, so choose by what an unknown value means here:`
        + ` write ${enumSide.name}.parse(text) == ${member} when the text must name a member — ${enumSide.name}.parse throws on anything else —`
        + ` or str(${member}) == text when unknown values are expected and must be ignored, as on an open wire protocol`;
    }
    if (left.kind === "null" || right.kind === "null") {
      const value = left.kind === "null" ? right : left;
      return `; ${describeType(value)} is never null — drop the check, or declare the value ${describeType(value)}? if absence is real`;
    }
    return "";
  }

  private valueLevelEnum(source: ValueType): Extract<ValueType, { kind: "enum" | "enumMember" }> | null {
    const type = this.host.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "enum" || type.kind === "enumMember") return type;
    if (type.kind === "optional") return this.valueLevelEnum(type.inner);
    if (type.kind === "union") {
      for (const member of type.members) {
        const found = this.valueLevelEnum(member);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * D102 ruling 1: the boundary the veto names is the one the wire value
   * crosses — a string-backed member meets raw strings, an integer-pinned one
   * meets raw numbers. The wording follows the value, so the report never
   * sends an author looking for a string in a line that holds a number.
   */
  enumMeetDomain(left: ValueType, right: ValueType): "string" | "number" {
    const enumSide = this.valueLevelEnum(left) ?? this.valueLevelEnum(right);
    if (enumSide === null) return "string";
    return this.enumWireScalarKinds(enumSide).has("string") ? "string" : "number";
  }

  private hasValueLevelString(source: ValueType): boolean {
    return this.hasValueLevelScalar(source, STRING_WIRE_KIND);
  }

  /**
   * D102 ruling 1: the scalar kinds an enum's wire values exit to. A member
   * answers for itself; the whole enum answers with every kind its members
   * declare, so a mixed enum vetoes both domains and the author narrows to a
   * member before comparing. An enum this analyzer cannot see keeps the
   * pre-D102 answer, which is the right one for every string-backed enum.
   */
  private enumWireScalarKinds(source: Extract<ValueType, { kind: "enum" | "enumMember" }>): ReadonlySet<"string" | "number"> {
    const wireValues = this.host.enumWireValuesOf(source.identity, source.name);
    if (!wireValues || wireValues.size === 0) return STRING_WIRE_KIND;
    if (source.kind === "enumMember") {
      return typeof wireValues.get(source.member) === "number" ? NUMBER_WIRE_KIND : STRING_WIRE_KIND;
    }
    const kinds = new Set<"string" | "number">();
    for (const value of wireValues.values()) kinds.add(typeof value === "number" ? "number" : "string");
    return kinds;
  }

  private hasValueLevelScalar(source: ValueType, kinds: ReadonlySet<"string" | "number">): boolean {
    const type = this.host.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "string" || type.kind === "number") return kinds.has(type.kind);
    if (type.kind === "optional") return this.hasValueLevelScalar(type.inner, kinds);
    if (type.kind === "union") return type.members.some((member) => this.hasValueLevelScalar(member, kinds));
    return false;
  }

  // D36 item 41: `==`/`!=` are SameValueZero, but the repair only matters
  // when both operands can be NaN at runtime. NaN lives exclusively inside
  // JavaScript numbers, so any operand whose static type excludes number
  // (and the unchecked kinds that could hide one) proves the repair away and
  // the emitter keeps plain `===`. A numeric literal operand is the value
  // check's degenerate case: NaN has no literal spelling, so the literal
  // itself can never be NaN.
  equalityOperandMayBeNaN(expression: Expression, type: ValueType): boolean {
    if (expression.kind === "LiteralExpression" && typeof expression.value === "number") return false;
    if (expression.kind === "UnaryExpression"
      && (expression.operator === "-" || expression.operator === "+")
      && expression.operand.kind === "LiteralExpression"
      && typeof expression.operand.value === "number") return false;
    return this.equalityMayCompareNaN(type);
  }

  equalityMayCompareNaN(type: ValueType): boolean {
    const expanded = this.host.expandAliases(type);
    switch (expanded.kind) {
      case "number":
      case "any":
      case "unknown":
      case "parameter":
        return true;
      case "optional":
        return this.equalityMayCompareNaN(expanded.inner);
      case "union":
        return expanded.members.some((member) => this.equalityMayCompareNaN(member));
      case "named":
        return expanded.name === "number";
      default:
        return false;
    }
  }

  requireOrderedComparison(
    leftType: ValueType,
    rightType: ValueType,
    leftExpression: Expression,
    rightExpression: Expression,
    operationSpan: Span,
  ): void {
    const left = this.host.expandAliases(leftType);
    const right = this.host.expandAliases(rightType);
    if (isInvalidType(left) || isInvalidType(right)) return;
    if (left.kind === "any" || right.kind === "any") return;
    const category = this.orderedTypeCategory(left);
    if (category !== null && category !== "dynamic" && category === this.orderedTypeCategory(right)) {
      // TXT-D1: a string ordering lowers through the code-point comparator.
      // Both the binary span and the chain-link span are recorded because
      // the two emitters key their lookups differently (exactly as the
      // SameValueZero hint does).
      const marked = category === "string" ? this.host.lowering.stringOrderings : category === "comparable" ? this.host.lowering.dynamicOrderings : null;
      if (marked) {
        marked.add(spanIdentity(operationSpan));
        marked.add(spanIdentity({ start: leftExpression.span.start, end: rightExpression.span.end }));
      }
      return;
    }
    this.host.typeError(
      `Ordered comparison requires two numbers or two strings, received ${describeType(leftType)} and ${describeType(rightType)}${this.unorderedTypeGuidance(left, right)}`,
      { start: leftExpression.span.start, end: Math.max(rightExpression.span.end, operationSpan.end) },
    );
  }

  // Diagnostic-only companion to `orderedTypeCategory`: an enum reaching an
  // ordering site is the one rejection with a non-obvious way out, because the
  // runtime value is a bare string and the order the author means is never the
  // member-name alphabet (D42 item 65).
  unorderedTypeGuidance(...types: readonly ValueType[]): string {
    return types.some((type) => this.mentionsEnumType(type))
      ? "; an enum carries no runtime order, so state the order explicitly with sorted(by=rank) or a string-backed enum whose values encode it"
      : "";
  }

  private mentionsEnumType(source: ValueType): boolean {
    const type = this.host.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "enum" || type.kind === "enumMember") return true;
    if (type.kind === "optional") return this.mentionsEnumType(type.inner);
    if (type.kind === "union") return type.members.some((member) => this.mentionsEnumType(member));
    if (type.kind === "list" || type.kind === "set") return this.mentionsEnumType(type.element);
    return false;
  }

  // D42 item 65: the single place in the compiler that answers "is this
  // ordered". Every ordering site — direct `<` `<=` `>` `>=`, `min()`/`max()`,
  // default `sorted()`, and the `sorted(by=)`, `min(by=)` and `max(by=)` keys —
  // asks this one question, because four mechanisms giving three answers was the
  // structural root of ORD-1/2/3. `Comparable` is exactly `number`, `string`,
  // and single-category unions of them: enums are bare strings at runtime, so
  // ordering them silently yields member-name alphabetical order. `any` and
  // `unknown` answer "dynamic" instead of an order, and each caller decides
  // whether an unchecked boundary value is admissible there.
  orderedTypeCategory(source: ValueType): "number" | "string" | "comparable" | "dynamic" | null {
    const type = this.host.resolveNamedClasses(this.host.expandAliases(source));
    if (type.kind === "any" || type.kind === "unknown") return "dynamic";
    if (type.kind === "number") return "number";
    if (type.kind === "string") return "string";
    // D41 item 61: a `Comparable`-bounded parameter has an order, but not one
    // category statically — two of them compare through the runtime
    // comparator, which keeps string ordering by code point (TXT-D1).
    if (type.kind === "parameter") return boundGrants(this.host.boundOf(type), "order") ? "comparable" : null;
    if (type.kind !== "union" || type.members.length === 0) return null;
    let category: "number" | "string" | null = null;
    for (const member of type.members) {
      const memberCategory = this.orderedTypeCategory(member);
      // A union mixing a bounded parameter with a concrete category has no
      // single order, exactly as a number/string union has none.
      if (memberCategory === null || memberCategory === "dynamic" || memberCategory === "comparable") return null;
      if (category !== null && category !== memberCategory) return null;
      category = memberCategory;
    }
    return category;
  }

  /** The reason a type cannot participate in equals(a, b), or null when it is pure data. */
  equalsDomainViolation(source: ValueType, seen: Set<string> = new Set()): string | null {
    const type = this.host.resolveNamedClasses(this.host.expandAliases(source));
    switch (type.kind) {
      case "class":
      case "classConstructor":
        return `${type.name} is a class instance; behavior objects compare by identity — use '=='`;
      case "function":
      case "action":
      case "intrinsic":
        return "a function has no structural content to compare";
      case "promise":
        return "a Promise has no structural content to compare; await it first";
      case "unknown":
        return "unknown must be validated first — parse it with a Type before comparing";
      case "any":
        return "any must be validated first — parse it with a Type before comparing";
      case "optional":
        return this.equalsDomainViolation(type.inner, seen);
      case "union": {
        for (const member of type.members) {
          const violation = this.equalsDomainViolation(member, seen);
          if (violation) return violation;
        }
        return null;
      }
      case "list":
      case "set":
        return this.equalsDomainViolation(type.element, seen);
      case "map":
        return this.equalsDomainViolation(type.key, seen) ?? this.equalsDomainViolation(type.value, seen);
      case "record":
        return this.equalsDomainViolation(type.value, seen);
      case "object": {
        for (const field of type.fields.values()) {
          const violation = this.equalsDomainViolation(field, seen);
          if (violation) return violation;
        }
        return null;
      }
      case "named": {
        const identity = type.identity ?? type.name;
        if (seen.has(identity)) return null;
        seen.add(identity);
        const fields = this.host.fieldsOf(identity);
        if (!fields) return null;
        for (const field of fields.values()) {
          const violation = this.equalsDomainViolation(field, seen);
          if (violation) return violation;
        }
        return null;
      }
      default:
        return null;
    }
  }
}
