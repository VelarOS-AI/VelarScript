/**
 * Which locations can carry a fact at all, and what a write takes away.
 *
 * A narrowing is filed under a *location* — a binding name, or a dotted path
 * of stored fields rooted at one. This module owns both halves of that: the
 * rules deciding whether a path is stable enough to file under (a getter is
 * recomputed on every read, an index is not a name, so neither qualifies), and
 * the invalidation family that retracts the facts an assignment, a mutating
 * collection call, or an aliasing member write just falsified.
 *
 * D114 R1d: split out of `./narrowing.ts` during the move, which came to 930
 * lines as one file — over the 800-line budget of D115 §一.1. The two halves
 * answer different questions ("what does this condition prove" against "where
 * may a fact live, and what kills it"), and the dependency runs one way:
 * `Narrowing` calls in here, and nothing here calls back.
 */
import { type AssignmentStatement, type Expression } from "../../ast.ts";
import { type ClassField } from "../../contracts.ts";
import { spanIdentity, type Span } from "../../source.ts";
import { nonOptional, optionalOf, type ValueType } from "../../types.ts";
import { type Binding, type MemberNarrowing } from "../scopes.ts";

/** An assignment statement's target, the one shape `invalidateAssignmentNarrowings` accepts. */
type AssignmentTarget = AssignmentStatement["target"];

/**
 * Everything the location half asks of the analyzer that hosts it, and nothing
 * more.
 */
export interface MemberLocationsHost {
  conditionSubjectText(condition: Expression): string | null;
  readonly currentClass: string | null;
  equalityTypesIntersect(leftSource: ValueType, rightSource: ValueType): boolean;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findStaticField(className: string, name: string): ClassField | null;
  findStaticGetter(className: string, name: string): ValueType | null;
  readonly flowFrameDepth: number;
  inferredExpressionType(expression: Expression): ValueType;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  lookup(name: string): Binding | null;
  readonly memberNarrowings: Map<string, MemberNarrowing>[];
  privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null;
  readonly privateGetters: Map<string, Set<string>>;
  readonly privateStaticGetters: Map<string, Set<string>>;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordFlowFactOrigin(binding: Binding): void;
  readonly scopes: Map<string, Binding>[];
  typeError(message: string, errorSpan: Span): void;
}

export class MemberLocations {
  private readonly host: MemberLocationsHost;

  constructor(host: MemberLocationsHost) {
    this.host = host;
  }

  /**
   * D90 R16: a getter is recomputed on every read, so a check against one
   * narrows nothing and silently does nothing. Say so where it is written,
   * and name the one spelling that works: bind the getter to a `const` and
   * check that. Following `?.` instead would compute the getter twice.
   */
  checkGetterNarrowingTest(condition: Expression): void {
    const subject = this.narrowingSubjectExpression(condition);
    if (!subject) return;
    const property = this.getterAccessProperty(subject);
    if (!property) return;
    const subjectType = this.host.inferredExpressionTypes.get(spanIdentity(subject.span));
    if (!subjectType) return;
    // Only a shape a check could have narrowed is worth naming. A getter
    // returning one concrete type is tested, not narrowed, and stays silent.
    const shape = this.host.expandAliases(subjectType).kind;
    if (shape !== "optional" && !(shape === "union" && subject !== condition)) return;
    const text = this.host.conditionSubjectText(subject);
    this.host.typeError(
      `'${property}' is a getter, so it is computed again on every read and this check narrows nothing`
      + `; bind it once with 'const ${property} = ${text ?? `...${property}`}' and check that name instead`,
      condition.span,
    );
  }

  /** The location a condition would narrow, for the forms that narrow one. */
  private narrowingSubjectExpression(condition: Expression): Expression | null {
    if (condition.kind === "UnaryExpression" && condition.operator === "not") {
      return this.narrowingSubjectExpression(condition.operand);
    }
    if (condition.kind === "IsExpression") return condition.value;
    if (condition.kind === "MemberExpression") return condition;
    if (condition.kind !== "BinaryExpression") return null;
    if (condition.operator === "in" || condition.operator === "not in") return condition.left;
    if (condition.operator !== "==" && condition.operator !== "!=") return null;
    // The literal forms that carry a fact back: a null test and, since `true`
    // and `false` are the two members of bool, a boolean-literal comparison.
    const narrowingLiteral = (side: Expression): boolean => side.kind === "LiteralExpression"
      && (side.value === null || typeof side.value === "boolean");
    const leftIsLiteral = narrowingLiteral(condition.left);
    const rightIsLiteral = narrowingLiteral(condition.right);
    return leftIsLiteral === rightIsLiteral ? null : leftIsLiteral ? condition.right : condition.left;
  }

  /** The property name when an expression reads a getter rather than a stored field. */
  getterAccessProperty(expression: Expression): string | null {
    if (expression.kind !== "MemberExpression" || expression.optional) return null;
    const inferred = this.host.inferredExpressionTypes.get(spanIdentity(expression.object.span))
      ?? (expression.object.kind === "IdentifierExpression" ? this.host.lookup(expression.object.name)?.type : null);
    if (!inferred) return null;
    const owner = nonOptional(this.host.expandAliases(inferred));
    if (owner.kind === "class") {
      const key = owner.identity ?? owner.name;
      const found = this.host.findGetter(key, expression.property) !== null
        || (this.host.privateGetters.get(this.host.currentClass ?? "")?.has(expression.property) ?? false);
      return found ? expression.property : null;
    }
    if (owner.kind === "classConstructor") {
      const key = owner.identity ?? owner.name;
      const found = this.host.findStaticGetter(key, expression.property) !== null
        || (this.host.privateStaticGetters.get(this.host.currentClass ?? "")?.has(expression.property) ?? false);
      return found ? expression.property : null;
    }
    return null;
  }

  /**
   * A check that narrows a location installs a shadow of the binding in the
   * scope it entered, so nested checks leave one shadow per enclosing scope.
   * Clearing only the innermost shadow lets an outer scope keep a fact this
   * write just falsified — visible after a `while` whose condition narrows
   * the same name its body assigns, where the body's shadow is discarded with
   * the body scope and the loop's own shadow never learns of the write.
   */
  invalidateShadowedNarrowings(name: string, target: Binding | null): void {
    if (!target) return;
    const storage = target.storageBinding ?? target;
    for (const scope of this.host.scopes) {
      const shadow = scope.get(name);
      if (!shadow || shadow === target || (shadow.storageBinding ?? shadow) !== storage) continue;
      this.host.recordFlowFactOrigin(shadow);
      shadow.storageType = storage.storageType;
      shadow.type = storage.storageType;
      shadow.narrowingFrame = null;
      shadow.assignedFact = false;
    }
  }

  stableMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.host.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression" || expression.optional) return null;
    const base = this.stableMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  stableOptionalMemberAccessPath(expression: Expression): string | null {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.host.lookup(expression.name);
      return binding ? `${binding.span.start}:${expression.name}` : null;
    }
    if (expression.kind !== "MemberExpression") return null;
    const base = this.stableOptionalMemberAccessPath(expression.object);
    if (!base || !this.stableDataMember(expression.object, expression.property)) return null;
    return `${base}.${expression.property}`;
  }

  /**
   * A getter is recomputed on every read and an index is not a name, so
   * neither is a stable location a fact can be filed under. What is left is a
   * stored field of a record, a named type, or a class.
   */
  stableDataMember(objectExpression: Expression, property: string): boolean {
    const inferred = this.host.inferredExpressionTypes.get(spanIdentity(objectExpression.span))
      ?? (objectExpression.kind === "IdentifierExpression" ? this.host.lookup(objectExpression.name)?.type : null);
    if (!inferred) return false;
    const owner = nonOptional(this.host.expandAliases(inferred));
    if (owner.kind === "union") return owner.members.length > 0
      && owner.members.every((member) => this.discriminatedDataField(member, property) !== null);
    if (owner.kind === "object") return owner.fields.has(property);
    if (owner.kind === "named") return this.host.fieldsOf(owner.identity ?? owner.name)?.has(property) ?? false;
    if (owner.kind === "class") {
      const key = owner.identity ?? owner.name;
      if (this.host.findGetter(key, property)) return false;
      if (this.host.privateGetters.get(this.host.currentClass ?? "")?.has(property)) return false;
      return Boolean(this.host.findField(key, property) || this.host.privateFieldForAccess(key, property, false));
    }
    if (owner.kind !== "classConstructor") return false;
    const key = owner.identity ?? owner.name;
    if (this.host.findStaticGetter(key, property)) return false;
    if (this.host.privateStaticGetters.get(this.host.currentClass ?? "")?.has(property)) return false;
    return Boolean(this.host.findStaticField(key, property) || this.host.privateFieldForAccess(key, property, true));
  }

  discriminatedDataField(original: ValueType, property: string): ValueType | null {
    const type = nonOptional(this.host.expandAliases(original));
    if (type.kind === "object") {
      const raw = type.fields.get(property);
      const field = raw && (type.readonlyView || type.readonlyFields?.has(property)) ? this.host.readonlyDataViewOf(raw) : raw;
      return field && type.optionalFields?.has(property) ? optionalOf(field) : field ?? null;
    }
    if (type.kind === "named") {
      const field = this.host.fieldsOf(type.identity ?? type.name)?.get(property) ?? null;
      return field && (type.readonlyView || this.host.readonlyFieldsOf(type.identity ?? type.name)?.has(property)) ? this.host.readonlyDataViewOf(field) : field;
    }
    return null;
  }

  dataFieldIsReadonly(original: ValueType, property: string): boolean {
    const type = nonOptional(this.host.expandAliases(original));
    if (type.kind === "union") return type.members.some((member) => this.dataFieldIsReadonly(member, property));
    if (type.kind === "object") {
      return type.fields.has(property) && (type.readonlyView === true || type.readonlyFields?.has(property) === true);
    }
    if (type.kind === "named") {
      return (this.host.fieldsOf(type.identity ?? type.name)?.has(property) ?? false)
        && (type.readonlyView === true || this.host.readonlyFieldsOf(type.identity ?? type.name)?.has(property) === true);
    }
    return false;
  }

  lookupMemberNarrowing(path: string): ValueType | null {
    return this.lookupMemberNarrowingEntry(path)?.type ?? null;
  }

  lookupMemberNarrowingEntry(path: string): MemberNarrowing | null {
    for (let index = this.host.memberNarrowings.length - 1; index >= 0; index -= 1) {
      const narrowing = this.host.memberNarrowings[index]?.get(path);
      if (narrowing && narrowing.frame === this.host.flowFrameDepth) return narrowing;
    }
    return null;
  }

  invalidateAssignmentNarrowings(target: AssignmentTarget, binding: Binding | null): void {
    if (target.kind === "IdentifierExpression") {
      if (binding && binding.narrowingFrame !== null) {
        this.host.recordFlowFactOrigin(binding);
        binding.type = binding.storageType;
        binding.narrowingFrame = null;
        binding.assignedFact = false;
      }
      if (binding) this.invalidateMemberNarrowings(`${binding.span.start}:${target.name}`);
      return;
    }
    if (target.kind !== "MemberExpression") return;
    const path = this.stableMemberAccessPath(target);
    if (path) this.invalidateMemberNarrowings(path);
  }

  invalidateMemberNarrowings(path: string): void {
    for (const scope of this.host.memberNarrowings) {
      for (const [candidate, narrowing] of scope) {
        if (narrowing.frame === this.host.flowFrameDepth
          && (candidate === path || candidate.startsWith(`${path}.`))) scope.delete(candidate);
      }
    }
  }

  private invalidateMemberDescendantNarrowings(path: string): void {
    for (const scope of this.host.memberNarrowings) {
      for (const [candidate, narrowing] of scope) {
        if (narrowing.frame === this.host.flowFrameDepth && candidate.startsWith(`${path}.`)) scope.delete(candidate);
      }
    }
  }

  invalidateMutableCollectionCallReceiver(callee: Extract<Expression, { kind: "MemberExpression" }>): void {
    const owner = nonOptional(this.host.expandAliases(this.host.inferredExpressionType(callee.object)));
    const mutating = owner.kind === "list"
      ? new Set(["append", "extend", "insert", "remove", "pop", "clear"])
      : owner.kind === "map" ? new Set(["set", "update", "remove", "clear"])
        : owner.kind === "set" ? new Set(["add", "update", "remove", "clear"])
          : owner.kind === "record" ? new Set(["set", "remove", "clear"])
            : null;
    if (!mutating?.has(callee.property)) return;
    const path = this.stableMemberAccessPath(callee.object);
    if (path) this.invalidateMemberDescendantNarrowings(path);
  }

  invalidateCurrentMemberNarrowings(): void {
    for (const scope of this.host.memberNarrowings) {
      for (const [path, narrowing] of scope) {
        if (narrowing.frame === this.host.flowFrameDepth) scope.delete(path);
      }
    }
  }

  // D44 rule 73: a member write invalidates the facts whose root could alias
  // an object the write mutates. Two roots whose types have no values in
  // common cannot be the same object, so unrelated roots keep their facts;
  // same-type roots still invalidate each other. Every receiver along the
  // written path is compared — `outer.inner.value = x` mutates the object at
  // `outer.inner`, which a fact root of that type may alias even when the
  // outermost roots' types are unrelated.
  invalidateAliasableMemberNarrowings(target: Extract<Expression, { kind: "MemberExpression" }>): void {
    const receiverTypes: ValueType[] = [];
    let receiver: Expression = target.object;
    for (;;) {
      const inferred = this.host.inferredExpressionTypes.get(spanIdentity(receiver.span))
        ?? (receiver.kind === "IdentifierExpression" ? this.host.lookup(receiver.name)?.type ?? null : null);
      if (!inferred) {
        // An unresolvable receiver keeps the previous conservative behavior.
        this.invalidateCurrentMemberNarrowings();
        return;
      }
      receiverTypes.push(inferred);
      if (receiver.kind !== "MemberExpression") break;
      receiver = receiver.object;
    }
    for (const scope of this.host.memberNarrowings) {
      for (const [path, narrowing] of scope) {
        if (narrowing.frame !== this.host.flowFrameDepth) continue;
        const rootType = this.memberNarrowingRootType(path);
        if (rootType !== null
          && !receiverTypes.some((receiverType) => this.host.equalityTypesIntersect(receiverType, rootType))) continue;
        scope.delete(path);
      }
    }
  }

  /** The current type of the binding a member-narrowing path is rooted at, or null when it cannot be resolved. */
  private memberNarrowingRootType(path: string): ValueType | null {
    const dot = path.indexOf(".");
    const root = dot === -1 ? path : path.slice(0, dot);
    const colon = root.indexOf(":");
    if (colon === -1) return null;
    const start = Number(root.slice(0, colon));
    const name = root.slice(colon + 1);
    for (let index = this.host.scopes.length - 1; index >= 0; index -= 1) {
      const binding = this.host.scopes[index]?.get(name);
      if (binding && binding.span.start === start) return binding.type;
    }
    return null;
  }
}
