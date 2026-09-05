/**
 * What a check proves, and what a write takes away: the rules that turn a
 * condition into facts about named locations, install those facts on the scope
 * that entered them, and retract the ones an assignment or a mutating call
 * falsified.
 *
 * D114 R1d: this is the narrowing half of the flow cluster — `conditionNarrowing`
 * and its eight sub-rules, the assignment-established facts of D44 rule 71, the
 * member-path bookkeeping (`stableMemberAccessPath` and the seven invalidators),
 * and the "not a stable location" rules that keep a getter or an index out of
 * the fact store. All of it was private methods of `Analyzer` interleaved with
 * everything else; here it is one collaborator the analyzer owns as
 * `this.narrowing`, and `NarrowingHost` is the exact record of what it needs
 * back from the analyzer.
 *
 * The two protected seams that expose it — `narrowingFor` and
 * `applyNarrowings` — stay declared on `Analyzer` and forward here, because
 * the Web and Node analyzers subclass that class and not this one.
 */
import { type AssignmentStatement, type BindingPattern, type Expression, type MatchPattern, type TypeReference } from "../../ast.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  boolType,
  isInvalidType,
  isReadonlyView,
  mutableViewOf,
  nullType,
  optionalOf,
  sameType,
  stringType,
  unionOf,
  unknownType,
  type EnumInfo,
  type ValueType,
} from "../../types.ts";
import { type Binding, type MemberNarrowing, memberNarrowingPrefix } from "../scopes.ts";
import { type MemberLocations } from "./locations.ts";

/** An assignment statement's target, the one shape `invalidateAssignmentNarrowings` accepts. */
type AssignmentTarget = AssignmentStatement["target"];

/**
 * Everything the narrowing half asks of the analyzer that hosts it, and
 * nothing more. The scope stack, the member-fact stack and the flow frame
 * depth all move under it while a condition is being analyzed, so they arrive
 * as live getters rather than as values captured at construction.
 */
export interface NarrowingHost {
  builtin(name: string): Binding | null;
  containsInferredResultPlaceholder(type: ValueType): boolean;
  enterScope(): void;
  readonly enums: Map<string, EnumInfo>;
  erasedClassCheckType(source: ValueType, checked: ValueType): ValueType;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly flowFrameDepth: number;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  iterationContract(type: ValueType): ValueType | null;
  lookup(name: string): Binding | null;
  matchTypesOverlap(left: ValueType, right: ValueType): boolean;
  readonly memberNarrowings: Map<string, MemberNarrowing>[];
  readonly narrowedNames: Set<string>[];
  readonlyDataViewOf(type: ValueType): ValueType;
  recordFlowFactOrigin(binding: Binding): void;
  recordScopedName(name: string): void;
  requireCondition(type: ValueType, condition: Expression): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  runtimeTypeCheckMayExecute(input: ValueType, checkedInput: ValueType): boolean;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  readonly scopes: Map<string, Binding>[];
  readonly locations: MemberLocations;
  survivingNarrowings(narrowed: ReadonlyMap<string, ValueType>): ReadonlyMap<string, ValueType>;
  trackNarrowingShadow(shadow: Binding): void;
}

export class Narrowing {
  private readonly host: NarrowingHost;

  /** The truthy/falsy facts a logical operator already decided, keyed by its span. */
  readonly logicalConditionNarrowings = new Map<string, {
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
  }>();

  constructor(host: NarrowingHost) {
    this.host = host;
  }

  conditionNarrowing(expression: Expression, truthy: boolean, knownType?: ValueType): ReadonlyMap<string, ValueType> {
    const logical = this.logicalConditionNarrowings.get(spanIdentity(expression.span));
    if (logical) return truthy ? logical.truthy : logical.falsy;
    const narrowed = new Map<string, ValueType>();
    if (expression.kind === "UnaryExpression" && expression.operator === "not") {
      return this.conditionNarrowing(expression.operand, !truthy);
    }
    if (expression.kind === "BinaryExpression"
      && (expression.operator === "in" || expression.operator === "not in")
      && (expression.operator === "in") === truthy) {
      return this.membershipNarrowing(expression, narrowed);
    }
    if (expression.kind === "BinaryExpression" && (expression.operator === "==" || expression.operator === "!=")) {
      return this.equalityNarrowing(expression, truthy, narrowed);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression"
      && expression.callee.property === "is" && expression.arguments.length === 1
      && expression.arguments[0]!.kind !== "SpreadExpression") {
      const target = this.validatorTargetOf(expression.callee.object);
      const value = expression.arguments[0]!;
      if (target) {
        const current = this.host.inferredExpressionTypes.get(spanIdentity(value.span)) ?? unknownType;
        if (truthy) this.addLocationNarrowing(narrowed, value, this.runtimeCheckedType(current, target));
        else {
          const remaining = this.excludeCheckedType(current, target);
          if (remaining) this.addLocationNarrowing(narrowed, value, remaining);
        }
      }
    } else if (expression.kind === "IdentifierExpression") {
      const type = this.host.lookup(expression.name)?.type;
      if (type?.kind === "optional") {
        const fact = this.bareConditionNarrowing(type, truthy);
        if (fact) narrowed.set(expression.name, fact);
      }
    } else if (expression.kind === "MemberExpression" && !expression.optional) {
      const path = this.host.locations.stableMemberAccessPath(expression);
      const type = knownType ?? this.host.inferredExpressionTypes.get(spanIdentity(expression.span));
      if (path && type?.kind === "optional") {
        const fact = this.bareConditionNarrowing(type, truthy);
        if (fact) narrowed.set(`${memberNarrowingPrefix}${path}`, fact);
      }
    } else if (expression.kind === "IsExpression") {
      const checked = this.host.resolveAnnotation(expression.type);
      const matches = expression.operator === "is" ? truthy : !truthy;
      if (matches) {
        const current = this.host.inferredExpressionTypes.get(spanIdentity(expression.value.span)) ?? unknownType;
        this.addLocationNarrowing(narrowed, expression.value, this.runtimeCheckedType(current, checked));
      } else {
        const current = this.host.inferredExpressionTypes.get(spanIdentity(expression.value.span));
        const remaining = current ? this.excludeCheckedType(current, checked) : null;
        if (remaining) this.addLocationNarrowing(narrowed, expression.value, remaining);
      }
    }
    return narrowed;
  }

  /**
   * FLW-N4: a membership test asks the `==` question one element at a time
   * (section 4), so a true answer means one element matched — and every
   * element is of the container's element or key type. The false answer
   * proves nothing: any element could be the one that failed to match.
   */
  private membershipNarrowing(
    expression: Extract<Expression, { kind: "BinaryExpression" }>,
    narrowed: Map<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    const container = this.host.inferredExpressionTypes.get(spanIdentity(expression.right.span));
    const contained = container ? this.membershipElementType(this.host.expandAliases(container)) : null;
    const current = this.host.inferredExpressionTypes.get(spanIdentity(expression.left.span));
    if (contained && current && this.narrowableLocation(expression.left)) {
      const narrowedType = this.runtimeCheckedType(current, contained);
      if (!sameType(narrowedType, this.host.expandAliases(current))) {
        this.addLocationNarrowing(narrowed, expression.left, narrowedType);
      }
    }
    return narrowed;
  }

  /** What `==` and `!=` prove: presence, an enum singleton, and the two members of bool. */
  private equalityNarrowing(
    expression: Extract<Expression, { kind: "BinaryExpression" }>,
    truthy: boolean,
    narrowed: Map<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    const leftIsNone = expression.left.kind === "LiteralExpression" && expression.left.value === null;
    const rightIsNone = expression.right.kind === "LiteralExpression" && expression.right.value === null;
    if (leftIsNone !== rightIsNone) {
      const candidate = leftIsNone ? expression.right : expression.left;
      const candidateType = this.host.inferredExpressionTypes.get(spanIdentity(candidate.span));
      if (candidateType?.kind === "optional") {
        const equalToNone = expression.operator === "==" ? truthy : !truthy;
        this.addLocationNarrowing(narrowed, candidate, equalToNone ? nullType : candidateType.inner);
        // FLW-N2: an optional chain that produced a non-null value proves
        // every link along it was present — an absent link is exactly what
        // the chain short-circuits on. The `== null` arm proves nothing,
        // because any one absent link produces the same null.
        if (!equalToNone) {
          for (const [path, type] of this.optionalExecutionNarrowings(candidate)) {
            if (!narrowed.has(path)) narrowed.set(path, type);
          }
        }
      }
    }
    const leftType = this.host.inferredExpressionTypes.get(spanIdentity(expression.left.span));
    const rightType = this.host.inferredExpressionTypes.get(spanIdentity(expression.right.span));
    const leftPath = this.narrowableLocation(expression.left);
    const rightPath = this.narrowableLocation(expression.right);
    const singleton = rightType?.kind === "enumMember" && leftPath
      ? { candidate: expression.left, current: leftType, singleton: rightType }
      : leftType?.kind === "enumMember" && rightPath
        ? { candidate: expression.right, current: rightType, singleton: leftType }
        : null;
    if (singleton?.current) {
      const equal = expression.operator === "==" ? truthy : !truthy;
      const narrowedType = this.narrowEnumMember(singleton.current, singleton.singleton, equal);
      if (narrowedType) this.addLocationNarrowing(narrowed, singleton.candidate, narrowedType);
    }
    // FLW-N7: `true` and `false` are the two members of bool, so equality
    // with either literal carries the singleton fact back to its owner
    // exactly as an enum member does. Only the branch that proves equality
    // learns anything: `flag != true` still admits both `false` and an
    // absent value, which is the same reason `if flag:` teaches its else
    // arm nothing.
    const leftIsBoolean = expression.left.kind === "LiteralExpression" && typeof expression.left.value === "boolean";
    const rightIsBoolean = expression.right.kind === "LiteralExpression" && typeof expression.right.value === "boolean";
    if (leftIsBoolean !== rightIsBoolean && (expression.operator === "==") === truthy) {
      const candidate = leftIsBoolean ? expression.right : expression.left;
      const candidateType = leftIsBoolean ? rightType : leftType;
      const narrowedType = candidateType ? this.narrowToBoolean(candidateType) : null;
      if (narrowedType) this.addLocationNarrowing(narrowed, candidate, narrowedType);
    }
    return narrowed;
  }

  /** What one element of a membership probe's container is, matching the `in` operand rules. */
  private membershipElementType(container: ValueType): ValueType | null {
    // D68 rule 177: the narrowing a membership test proves must read the same
    // container the test itself read, so it walks `@iterate:` too.
    const source = this.host.iterationContract(container) ?? container;
    if (source.kind === "list" || source.kind === "set") return source.element;
    if (source.kind === "map") return source.key;
    if (source.kind === "record" || source.kind === "string") return stringType;
    return null;
  }

  /** The concrete checked value behind `Kind.is(value)`, when Kind is a runtime validator. */
  private validatorTargetOf(object: Expression): ValueType | null {
    if (object.kind !== "IdentifierExpression") return null;
    const type = this.host.lookup(object.name)?.type ?? this.host.builtin(object.name)?.type;
    if (!type) return null;
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "typeObject") return this.host.runtimeTypeObjectValue(type);
    if (type.kind === "runtimeType") return type.value;
    return null;
  }

  // A bare optional condition is legal only for 'bool?', where it judges truth:
  // the true branch proves 'true', and the else branch learns nothing because
  // both 'false' and an absent value reach it. Every other optional is rejected
  // in condition position; those keep the old presence fact so one rejected
  // line does not also cascade optional-access errors through its own body.
  private bareConditionNarrowing(type: Extract<ValueType, { kind: "optional" }>, truthy: boolean): ValueType | null {
    if (this.host.expandAliases(type.inner).kind === "bool") return truthy ? boolType : null;
    return truthy ? type.inner : nullType;
  }

  private excludeCheckedType(current: ValueType, checked: ValueType): ValueType | null {
    if (current.kind === "optional") {
      const innerExcluded = this.host.isAssignableHere(current.inner, checked);
      const noneExcluded = this.host.isAssignableHere(nullType, checked);
      if (innerExcluded && !noneExcluded) return nullType;
      if (noneExcluded && !innerExcluded) return current.inner;
      return null;
    }
    if (current.kind !== "union") return null;
    const remaining = current.members.filter((member) => !this.host.isAssignableHere(member, checked));
    return remaining.length > 0 && remaining.length < current.members.length ? unionOf(remaining) : null;
  }

  addLocationNarrowing(target: Map<string, ValueType>, expression: Expression, type: ValueType): void {
    if (expression.kind === "IdentifierExpression") {
      if (this.host.lookup(expression.name)) target.set(expression.name, type);
      return;
    }
    const path = this.host.locations.stableMemberAccessPath(expression);
    if (path) {
      target.set(`${memberNarrowingPrefix}${path}`, type);
      if (expression.kind === "MemberExpression") {
        const owner = this.host.inferredExpressionTypes.get(spanIdentity(expression.object.span));
        const narrowedOwner = owner ? this.narrowDiscriminatedOwner(owner, expression.property, type) : null;
        if (narrowedOwner) this.addLocationNarrowing(target, expression.object, narrowedOwner);
      }
    }
  }

  private narrowableLocation(expression: Expression): boolean {
    return expression.kind === "IdentifierExpression"
      ? this.host.lookup(expression.name) !== null
      : this.host.locations.stableMemberAccessPath(expression) !== null;
  }

  private narrowEnumMember(current: ValueType, singleton: Extract<ValueType, { kind: "enumMember" }>, equal: boolean): ValueType | null {
    const source = this.host.expandAliases(current);
    const sameSingleton = (candidate: ValueType): boolean => candidate.kind === "enumMember"
      && candidate.identity === singleton.identity
      && candidate.member === singleton.member;
    if (equal) {
      if (source.kind === "enum" && source.identity === singleton.identity) return singleton;
      if (source.kind === "enumMember") return sameSingleton(source) ? source : null;
      if (source.kind === "union") return source.members.some(sameSingleton) ? singleton : null;
      return null;
    }
    if (source.kind === "union") {
      const remaining = source.members.filter((member) => !sameSingleton(member));
      return remaining.length > 0 && remaining.length < source.members.length ? unionOf(remaining) : null;
    }
    if (source.kind === "enum" && source.identity === singleton.identity) {
      const members = this.host.enums.get(source.identity)?.members ?? this.host.enums.get(source.name)?.members;
      if (!members) return null;
      const remaining = [...members]
        .filter((member) => member !== singleton.member)
        .map((member): ValueType => ({ kind: "enumMember", name: source.name, identity: source.identity, member }));
      return remaining.length > 0 ? unionOf(remaining) : null;
    }
    return null;
  }

  /**
   * FLW-N7: the fact a boolean-literal comparison proves about its owner.
   * A location already typed `bool` learns nothing, so no fact is recorded
   * for it — a needless fact would only buy a runtime recheck on every later
   * read.
   */
  private narrowToBoolean(current: ValueType): ValueType | null {
    const source = this.host.expandAliases(current);
    if (source.kind === "optional") return this.host.expandAliases(source.inner).kind === "bool" ? boolType : null;
    if (source.kind !== "union") return null;
    const matching = source.members.filter((member) => this.host.expandAliases(member).kind === "bool");
    return matching.length > 0 && matching.length < source.members.length ? boolType : null;
  }

  private narrowDiscriminatedOwner(owner: ValueType, property: string, narrowedField: ValueType): ValueType | null {
    const source = this.host.expandAliases(owner);
    if (source.kind !== "union") return null;
    const candidates = source.members.filter((member) => {
      const field = this.host.locations.discriminatedDataField(member, property);
      return field !== null && this.host.matchTypesOverlap(field, narrowedField);
    });
    return candidates.length > 0 && candidates.length < source.members.length ? unionOf(candidates) : null;
  }

  inferNarrowedExpression(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
    contextualType: ValueType,
  ): ValueType {
    return this.withTemporaryNarrowings(narrowed, expression.span, () => this.host.inferExpression(expression, contextualType));
  }

  withTemporaryNarrowings<T>(
    narrowed: ReadonlyMap<string, ValueType>,
    narrowingSpan: Span,
    analyze: () => T,
  ): T {
    if (narrowed.size === 0) return analyze();
    this.host.enterScope();
    try {
      this.applyNarrowings(narrowed, narrowingSpan);
      return analyze();
    } finally {
      this.host.exitScope();
    }
  }

  optionalExecutionNarrowings(expression: Expression): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    const visit = (candidate: Expression): void => {
      const known = this.host.inferredExpressionTypes.get(spanIdentity(candidate.span));
      const expanded = known ? this.host.expandAliases(known) : null;
      if (expanded?.kind === "optional") {
        if (candidate.kind === "IdentifierExpression" && this.host.lookup(candidate.name)) {
          narrowed.set(candidate.name, expanded.inner);
        } else if (candidate.kind === "MemberExpression") {
          const path = this.host.locations.stableOptionalMemberAccessPath(candidate);
          if (path) narrowed.set(`${memberNarrowingPrefix}${path}`, expanded.inner);
        }
      }
      if (candidate.kind === "MemberExpression" || candidate.kind === "IndexExpression") {
        visit(candidate.object);
      } else if (candidate.kind === "CallExpression") {
        visit(candidate.callee);
      }
    };
    visit(expression);
    return narrowed;
  }

  inferConditionWithNarrowings(
    expression: Expression,
    narrowed: ReadonlyMap<string, ValueType>,
  ): {
    readonly type: ValueType;
    readonly truthy: ReadonlyMap<string, ValueType>;
    readonly falsy: ReadonlyMap<string, ValueType>;
    readonly surviving: ReadonlyMap<string, ValueType>;
  } {
    if (narrowed.size === 0) {
      const type = this.host.inferExpression(expression);
      this.host.requireCondition(type, expression);
      return {
        type,
        truthy: this.conditionNarrowing(expression, true, type),
        falsy: this.conditionNarrowing(expression, false, type),
        surviving: new Map(),
      };
    }
    this.host.enterScope();
    try {
      this.applyNarrowings(narrowed, expression.span);
      const type = this.host.inferExpression(expression);
      this.host.requireCondition(type, expression);
      return {
        type,
        truthy: this.conditionNarrowing(expression, true, type),
        falsy: this.conditionNarrowing(expression, false, type),
        surviving: this.host.survivingNarrowings(narrowed),
      };
    } finally {
      this.host.exitScope();
    }
  }

  combineNarrowings(
    first: ReadonlyMap<string, ValueType>,
    second: ReadonlyMap<string, ValueType>,
  ): ReadonlyMap<string, ValueType> {
    return new Map([...first, ...second]);
  }

  applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void {
    const memberScope = this.host.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.host.flowFrameDepth });
      } else {
        const binding = this.host.lookup(key);
        const shadow: Binding = {
          mutable: binding?.mutable ?? false,
          type,
          declaredType: binding?.declaredType ?? type,
          storageType: binding?.storageType ?? type,
          ...(binding ? { storageBinding: binding.storageBinding ?? binding } : {}),
          span: binding?.span ?? narrowingSpan,
          narrowingFrame: this.host.flowFrameDepth,
          flowScope: this.host.scopes.length - 1,
          ...(binding?.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        };
        this.host.trackNarrowingShadow(shadow);
        this.host.narrowedNames.at(-1)!.add(key);
        if (!this.host.scopes.at(-1)!.has(key)) this.host.recordScopedName(key);
        this.host.scopes.at(-1)!.set(key, shadow);
      }
    }
  }

  persistNarrowings(narrowed: ReadonlyMap<string, ValueType>): void {
    const scope = this.host.scopes.at(-1)!;
    const memberScope = this.host.memberNarrowings.at(-1)!;
    for (const [key, type] of narrowed) {
      if (key.startsWith(memberNarrowingPrefix)) {
        memberScope.set(key.slice(memberNarrowingPrefix.length), { type, frame: this.host.flowFrameDepth });
        continue;
      }
      const binding = this.host.lookup(key);
      if (!binding) continue;
      const local = scope.get(key);
      this.host.narrowedNames.at(-1)!.add(key);
      if (local) {
        this.host.recordFlowFactOrigin(local);
        local.type = type;
        local.narrowingFrame = this.host.flowFrameDepth;
        // A persisted (checked or merged) fact is not assignment-established.
        local.assignedFact = false;
      } else {
        const shadow: Binding = {
          mutable: binding.mutable,
          type,
          declaredType: binding.declaredType,
          storageType: binding.storageType,
          storageBinding: binding.storageBinding ?? binding,
          span: binding.span,
          narrowingFrame: this.host.flowFrameDepth,
          flowScope: this.host.scopes.length - 1,
          ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
        };
        this.host.trackNarrowingShadow(shadow);
        this.host.recordScopedName(key);
        scope.set(key, shadow);
      }
    }
  }

  // D44 rule 71: an assignment (including a declaration initializer)
  // establishes the right-hand side's type as a fact for the assigned
  // location — after an assignment the value there is the assigned value, so
  // this is the most reliable fact the system carries. The fact is spelled as
  // the declared arm the value inhabits when exactly one arm fits, so reads
  // keep the declared vocabulary. No fact is established when the assignment
  // adds nothing (`x = maybeNull()` keeps `string?`), when the declared type
  // is not a refinable domain (only optionals, unions, and `unknown` are),
  // when the value is `null` (the declaration `let x: string? = null` leaves
  // the declared question open), or when either side is an escape hatch.
  private assignedFactType(assigned: ValueType, storage: ValueType): ValueType | null {
    if (isInvalidType(assigned) || isInvalidType(storage)) return null;
    if (assigned.kind === "any" || assigned.kind === "null") return null;
    if (this.host.containsInferredResultPlaceholder(assigned)) return null;
    const expandedStorage = this.host.expandAliases(storage);
    if (expandedStorage.kind !== "optional" && expandedStorage.kind !== "union" && expandedStorage.kind !== "unknown") return null;
    if (expandedStorage.kind === "unknown" && expandedStorage.restricted) return null;
    if (!this.host.isAssignableHere(assigned, storage)) return null;
    if (this.host.isAssignableHere(storage, assigned)) return null;
    if (expandedStorage.kind === "unknown") return assigned;
    const arms = expandedStorage.kind === "optional" ? [expandedStorage.inner] : expandedStorage.members;
    const matching = arms.filter((arm) => this.host.isAssignableHere(assigned, arm));
    return matching.length === 1 ? matching[0]! : null;
  }

  establishAssignedFact(name: string, assigned: ValueType): void {
    const binding = this.host.lookup(name);
    if (!binding) return;
    const fact = this.assignedFactType(assigned, (binding.storageBinding ?? binding).storageType);
    if (fact === null) return;
    const scope = this.host.scopes.at(-1)!;
    const local = scope.get(name);
    this.host.narrowedNames.at(-1)!.add(name);
    if (local) {
      this.host.recordFlowFactOrigin(local);
      local.type = fact;
      local.narrowingFrame = this.host.flowFrameDepth;
      local.assignedFact = true;
    } else {
      const shadow: Binding = {
        mutable: binding.mutable,
        type: fact,
        declaredType: binding.declaredType,
        storageType: binding.storageType,
        storageBinding: binding.storageBinding ?? binding,
        span: binding.span,
        narrowingFrame: this.host.flowFrameDepth,
        assignedFact: true,
        flowScope: this.host.scopes.length - 1,
        ...(binding.reactiveKind ? { reactiveKind: binding.reactiveKind } : {}),
      };
      this.host.trackNarrowingShadow(shadow);
      this.host.recordScopedName(name);
      scope.set(name, shadow);
    }
  }

  /** Rule 71 for member targets: establish after invalidation so the new fact survives its own write. */
  establishAssignedMemberFact(
    target: Extract<Expression, { kind: "MemberExpression" }>,
    assigned: ValueType,
    declaredMemberType: ValueType,
  ): void {
    const fact = this.assignedFactType(assigned, declaredMemberType);
    if (fact === null) return;
    const path = this.host.locations.stableMemberAccessPath(target);
    if (!path) return;
    this.host.memberNarrowings.at(-1)!.set(path, {
      type: fact,
      frame: this.host.flowFrameDepth,
      assigned: true,
      domain: declaredMemberType,
    });
  }

  /** Rule 71 for destructuring declarations: each binding learns its own initializer piece. */
  establishAssignedPatternFacts(pattern: BindingPattern, assigned: ValueType): void {
    if (pattern.kind === "NameBindingPattern") {
      this.establishAssignedFact(pattern.name, assigned);
      return;
    }
    const expanded = this.host.expandAliases(assigned);
    if (pattern.kind === "ListBindingPattern") {
      if (expanded.kind !== "list") return;
      const element = expanded.readonlyView ? this.host.readonlyDataViewOf(expanded.element) : expanded.element;
      for (const child of pattern.elements) if (child) this.establishAssignedPatternFacts(child, element);
      return;
    }
    const fields = expanded.kind === "object" ? expanded.fields
      : expanded.kind === "named" ? this.host.fieldsOf(expanded.identity ?? expanded.name) : null;
    if (!fields) return;
    for (const entry of pattern.entries) {
      const field = fields.get(entry.property);
      if (!field) continue;
      const piece = expanded.kind === "object" && expanded.optionalFields?.has(entry.property)
        ? optionalOf(field)
        : field;
      this.establishAssignedPatternFacts(entry.pattern, piece);
    }
  }

  runtimeCheckedType(input: ValueType, rawChecked: ValueType): ValueType {
    const source = this.host.expandAliases(input);
    const checked = this.host.erasedClassCheckType(source, rawChecked);
    // D85 rule 210: `unknown` is the one checked domain that proves nothing,
    // so a check against it leaves the subject's own type alone. Without this
    // a membership probe against a container whose element or key type is
    // `unknown` replaced a `string` subject with `unknown`, which is a
    // widening — every later read of it then failed for the wrong reason.
    if (this.host.expandAliases(checked).kind === "unknown") return source;
    const candidates = source.kind === "union" ? source.members
      : source.kind === "optional" ? [source.inner, nullType]
        : [source];
    const mutableChecked = mutableViewOf(checked);
    const matching = candidates.filter((candidate) => this.host.matchTypesOverlap(mutableViewOf(candidate), mutableChecked));
    return matching.length > 0 && matching.every((candidate) => isReadonlyView(candidate))
      ? this.host.readonlyDataViewOf(checked)
      : checked;
  }

  matchPatternReflectionMayExecute(pattern: MatchPattern, input: ValueType): boolean {
    if (pattern.kind === "MatchAsPattern") return this.matchPatternReflectionMayExecute(pattern.pattern, input);
    const type = this.host.expandAliases(input);
    if (type.kind === "union") {
      return type.members.some((member) => this.matchPatternReflectionMayExecute(pattern, member));
    }
    if (type.kind === "optional") return this.matchPatternReflectionMayExecute(pattern, type.inner);
    if (pattern.kind === "MatchTypePattern") {
      return this.host.runtimeTypeCheckMayExecute(type, this.host.resolveAnnotation(pattern.type));
    }
    if (pattern.kind === "MatchListPattern") {
      if (type.kind === "any") return true;
      const element = type.kind === "list" ? type.element : unknownType;
      return pattern.elements.some((child) => this.matchPatternReflectionMayExecute(child, element));
    }
    if (pattern.kind !== "MatchObjectPattern") return false;
    if (type.kind === "any") return true;
    const fields = type.kind === "object" ? type.fields
      : type.kind === "named" ? this.host.fieldsOf(type.identity ?? type.name)
        : null;
    return pattern.entries.some((entry) => this.matchPatternReflectionMayExecute(
      entry.pattern,
      fields?.get(entry.property) ?? unknownType,
    ));
  }
}
