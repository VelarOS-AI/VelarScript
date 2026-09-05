/**
 * `x = value`, `x.field = value`, `x[key] = value`: what may be written to,
 * what the written value is judged against, and the flow facts a write
 * establishes or retracts.
 *
 * D115 §三: this was `analyzeAssignment` (208 lines) and the one helper it
 * reads. It is split here into the three targets it always distinguished — a
 * name, a member, and an index — so each is a screen rather than a scroll. The
 * three write one record of target facts between them, which is what the one
 * method's three `let`s were, and the value half that reads those facts runs
 * exactly where it ran before.
 */
import { type AssignmentStatement, type AssignmentTarget, type Expression } from "../../ast.ts";
import { type ClassField, type ClassInfo } from "../../contracts.ts";
import { type Diagnostic, type DiagnosticFix, diagnostic } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type ValueType,
  binaryStorageKind,
  describeType,
  isReadonlyView,
  nonOptional,
  numberType,
  stringType,
  unknownType,
} from "../../types.ts";
import { continuesOptionalChain } from "../calls/inference.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/** What an assignment statement asks of the analyzer that hosts it, and nothing more. */
export interface AssignmentAnalysisHost {
  bindingScopeDepth(name: string): number;
  carriedOwnedResource(expression: Expression | null): { readonly handle: string; readonly depth: number } | null;
  checkShadowedRead(name: string, span: Span): void;
  classInfo(key: string): ClassInfo | undefined;
  readonly constructorFieldInitializations: Set<number>;
  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean;
  readonly currentClass: string | null;
  dataFieldIsReadonly(original: ValueType, property: string): boolean;
  readonly diagnostics: Diagnostic[];
  establishAssignedFact(name: string, assigned: ValueType): void;
  establishAssignedMemberFact(target: Extract<Expression, { kind: "MemberExpression" }>, assigned: ValueType, declaredMemberType: ValueType): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findStaticField(className: string, name: string): ClassField | null;
  findStaticGetter(className: string, name: string): ValueType | null;
  findStaticMethod(className: string, name: string): ValueType | null;
  readonly importedBindingOrigins: Map<Binding, string>;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferMember(objectExpression: Expression, property: string, optional: boolean, memberSpan: Span, useNarrowing?: boolean, readValue?: boolean): ValueType;
  inferredOrAnalyze(expression: Expression): ValueType;
  invalidateAliasableMemberNarrowings(target: Extract<Expression, { kind: "MemberExpression" }>): void;
  invalidateAssignmentNarrowings(target: AssignmentTarget, binding: Binding | null): void;
  invalidateShadowedNarrowings(name: string, target: Binding | null): void;
  lookup(name: string): Binding | null;
  readonly lowering: LoweringRecorder;
  readonly primitiveMutableFields: Map<string, Set<string>>;
  readonly primitiveNames: Set<string>;
  readonly primitiveParents: Map<string, Set<string>>;
  privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null;
  readonly privateGetters: Map<string, Set<string>>;
  privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordFlowFactOrigin(binding: Binding): void;
  rejectOwnedResourceEscape(expression: Expression | null, action: string, errorSpan: Span): boolean;
  reportUnresolvedName(name: string, span: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

/** What one assignment writes to: its type, its binding, and whether it may be written at all. */
interface AssignmentTargetFacts {
  targetType: ValueType;
  targetBinding: Binding | null;
  targetWritable: boolean;
}

export class AssignmentAnalysis {
  private readonly host: AssignmentAnalysisHost;

  constructor(host: AssignmentAnalysisHost) {
    this.host = host;
  }

  analyzeAssignment(statement: AssignmentStatement): void {
    const operator = statement.operator;
    const facts: AssignmentTargetFacts = { targetType: unknownType, targetBinding: null, targetWritable: true };

    if (statement.target.kind !== "IdentifierExpression" && continuesOptionalChain(statement.target)) {
      this.host.diagnostics.push(diagnostic("VEL3002", "Optional chains cannot be assignment targets", statement.target.span));
      facts.targetWritable = false;
    }

    if (statement.target.kind === "IdentifierExpression") {
      if (!this.resolveNameTarget(statement.target, operator, facts)) return;
    } else if (statement.target.kind === "MemberExpression") {
      this.resolveMemberTarget(statement.target, operator, facts);
    } else {
      this.resolveIndexTarget(statement.target, operator, facts);
    }
    const { targetType, targetBinding, targetWritable } = facts;

    const valueType = this.host.inferExpression(statement.value, operator === "=" ? targetType : unknownType);
    // D51 rule 101: a store into a member, an index, or any binding declared
    // outside the owning scope outlives the release. A store into a binding at
    // or inside the owning scope dies with it, so it stays legal.
    const carriedValue = this.host.carriedOwnedResource(statement.value);
    if (carriedValue) {
      const targetDepth = statement.target.kind === "IdentifierExpression"
        ? this.host.bindingScopeDepth(statement.target.name)
        : 0;
      if (targetDepth < carriedValue.depth) {
        this.host.rejectOwnedResourceEscape(statement.value, "storing it here", statement.value.span);
      }
    }

    if (operator !== "=" && targetType.kind !== "number" && !(operator === "+=" && targetType.kind === "string")) {
      this.host.typeError(`Operator '${operator}' is not valid for ${describeType(targetType)}`, statement.span);
    }
    const assignmentValid = this.host.contextuallyAssignable(valueType, targetType, statement.value.span);
    const mutableCell: MutableCellTarget | null = statement.target.kind === "IdentifierExpression"
      && targetBinding?.mutable === true && targetBinding.reactiveKind !== "prop"
      ? { name: statement.target.name, keyword: targetBinding.reactiveKind === "state" ? "state" : "let" }
      : null;
    this.host.requireAssignable(valueType, targetType, statement.value.span, mutableCell);
    if (targetWritable && assignmentValid) {
      if (statement.target.kind === "MemberExpression") {
        // D44 rules 71 and 73: invalidate first, then establish, so the new
        // fact for the written path survives its own invalidation.
        this.host.invalidateAliasableMemberNarrowings(statement.target);
        if (operator === "=") this.host.establishAssignedMemberFact(statement.target, valueType, targetType);
      } else if (operator === "=") {
        this.host.invalidateAssignmentNarrowings(statement.target, targetBinding);
        if (targetBinding?.mutable) {
          const storageBinding = targetBinding.storageBinding ?? targetBinding;
          const rebound = storageBinding.declaredType.kind !== "unknown" ? storageBinding.declaredType : valueType;
          this.host.recordFlowFactOrigin(storageBinding);
          this.host.recordFlowFactOrigin(targetBinding);
          storageBinding.storageType = rebound;
          if (storageBinding.narrowingFrame === null) storageBinding.type = rebound;
          targetBinding.storageType = rebound;
          targetBinding.type = rebound;
        }
        // D44 rule 71: the assignment establishes the right-hand side's type
        // as the location's fact (`x = maybeNull()` establishes nothing —
        // the assigned type must actually refine the declared one).
        if (statement.target.kind === "IdentifierExpression") {
          this.host.invalidateShadowedNarrowings(statement.target.name, targetBinding);
          this.host.establishAssignedFact(statement.target.name, valueType);
        }
      }
    }
  }


  /**
   * A bare name: the binding it resolves to, whether it may be written, and
   * the declared type a plain `=` is judged against. Answers false when the
   * name resolves to nothing, which is the whole of the assignment.
   *
   * D115 §三 split this out of `analyzeAssignment`; the checks and their order
   * are unchanged.
   */
  private resolveNameTarget(
    target: Extract<AssignmentTarget, { kind: "IdentifierExpression" }>,
    operator: AssignmentStatement["operator"],
    facts: AssignmentTargetFacts,
  ): boolean {
      const binding = this.host.lookup(target.name);
      if (!binding) {
        this.host.reportUnresolvedName(target.name, target.span);
        return false;
      }
      this.host.checkShadowedRead(target.name, target.span);
      if (binding.reactiveKind) this.host.lowering.reactiveReferences.set(spanIdentity(target.span), binding.reactiveKind);
      if (!binding.mutable) {
        // MOD-I3: an import is not a const declaration; every import (.vel
        // and JavaScript alike) says so and names the owning module.
        const importOrigin = this.host.importedBindingOrigins.get(binding.storageBinding ?? binding)
          ?? this.host.importedBindingOrigins.get(binding);
        this.host.diagnostics.push(diagnostic(
          "VEL3002",
          importOrigin !== undefined
            ? `Cannot assign to imported binding '${target.name}'; imports are read-only. Change the value in its owning module (${JSON.stringify(importOrigin)}), or copy it into a local 'let' first`
            : `Cannot assign to const binding '${target.name}'`,
          target.span,
        ));
        facts.targetWritable = false;
      }
      facts.targetBinding = binding;
      facts.targetType = operator !== "=" ? binding.type : (binding.storageBinding ?? binding).declaredType;
    return true;
  }

  /**
   * A member: what the owner publishes under that name, and the eight ways a
   * member can be unwritable — a private getter or const field, a private
   * method, a const field, a getter, a method, a read-only view, a read-only
   * field, and a primitive member no extension made writable.
   *
   * D115 §三 split this out of `analyzeAssignment`; the checks and their order
   * are unchanged.
   */
  private resolveMemberTarget(
    target: Extract<AssignmentTarget, { kind: "MemberExpression" }>,
    operator: AssignmentStatement["operator"],
    facts: AssignmentTargetFacts,
  ): void {
      facts.targetType = this.host.inferMember(
        target.object,
        target.property,
        target.optional,
        target.span,
        operator !== "=",
        operator !== "=",
      );
      const owner = nonOptional(this.host.expandAliases(this.host.inferredOrAnalyze(target.object)));
      if (owner.kind === "union" && this.host.dataFieldIsReadonly(owner, target.property)) {
        this.host.diagnostics.push(diagnostic(
          "VEL3002",
          `Cannot assign field '${target.property}' through ${describeType(owner)} because at least one variant exposes it as read-only; narrow the owner first`,
          target.span,
        ));
        facts.targetWritable = false;
      } else if (owner.kind === "class") {
        const key = owner.identity ?? owner.name;
        const info = this.host.classInfo(key) ?? this.host.classInfo(owner.name);
        const privateField = this.host.privateFieldForAccess(key, target.property, false);
        const privateMethod = this.host.privateMethodForAccess(key, target.property, false);
        const field = this.host.findField(key, target.property);
        const getter = this.host.findGetter(key, target.property);
        const method = this.host.findMethod(key, target.property);
        if (privateField && (this.host.privateGetters.get(this.host.currentClass ?? "")?.has(target.property) ?? false)) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private getter '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if (privateField && !privateField.mutable && !this.host.constructorFieldInitializations.has(target.span.start)) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private const field '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if (privateMethod) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private method '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if (field && !field.mutable && !this.host.constructorFieldInitializations.has(target.span.start)) {
          const label = info?.identity ? "read-only member" : "const field";
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if (getter) {
          const label = info?.identity?.startsWith("js:") ? "read-only member" : "getter";
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to ${label} '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if (method) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${target.property}'`, target.span));
          facts.targetWritable = false;
        }
      } else if (owner.kind === "classConstructor") {
        const key = owner.identity ?? owner.name;
        const privateField = this.host.privateFieldForAccess(key, target.property, true);
        const privateMethod = this.host.privateMethodForAccess(key, target.property, true);
        const field = this.host.findStaticField(key, target.property);
        const getter = this.host.findStaticGetter(key, target.property);
        const method = this.host.findStaticMethod(key, target.property);
        if ((privateField && !privateField.mutable) || privateMethod) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to private static member '${target.property}'`, target.span));
          facts.targetWritable = false;
        } else if ((field && !field.mutable) || getter || method) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only static member '${target.property}'`, target.span));
          facts.targetWritable = false;
        }
      } else if (owner.kind === "object" && owner.readonlyFields?.has(target.property)) {
        this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only field '${target.property}'`, target.span));
        facts.targetWritable = false;
      } else if ((owner.kind === "object" || owner.kind === "named") && isReadonlyView(owner)) {
        this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign through ${describeType(owner)}; it is a read-only view`, target.span));
        facts.targetWritable = false;
      } else if (owner.kind === "named" && this.host.readonlyFieldsOf(owner.identity ?? owner.name)?.has(target.property)) {
        this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only field '${target.property}'`, target.span));
        facts.targetWritable = false;
      } else if (owner.kind === "named" && this.host.primitiveNames.has(owner.name)
        && this.host.fieldsOf(owner.identity ?? owner.name)?.has(target.property)
        && !this.primitiveFieldWritable(owner.name, target.property)) {
        this.host.diagnostics.push(diagnostic("VEL3002", `Cannot assign to read-only member '${target.property}'`, target.span));
        facts.targetWritable = false;
      } else if (owner.kind === "object" && owner.optionalFields?.has(target.property)) {
        facts.targetType = owner.fields.get(target.property) ?? facts.targetType;
      }
  }

  /**
   * An index: the four receivers a bracket assignment is defined for — a
   * binary view, a List, a Record, and the Map that is refused in favour of
   * `Map.set` — and the index type each of them requires.
   *
   * D115 §三 split this out of `analyzeAssignment`; the checks and their order
   * are unchanged.
   */
  private resolveIndexTarget(
    target: Extract<AssignmentTarget, { kind: "IndexExpression" }>,
    operator: AssignmentStatement["operator"],
    facts: AssignmentTargetFacts,
  ): void {
      const objectType = this.host.expandAliases(this.host.inferExpression(target.object));
      const indexType = this.host.inferExpression(target.index);
      const binaryKind = binaryStorageKind(objectType);
      if (binaryKind) {
        this.host.requireAssignable(indexType, numberType, target.index.span);
        facts.targetType = numberType;
        this.host.lowering.binaryIndexes.set(spanIdentity(target.span), binaryKind);
        if (binaryKind === "bytes") {
          this.host.diagnostics.push(diagnostic(
            "VEL3002",
            "Cannot index-assign Bytes; it is a read-only binary snapshot",
            target.span,
          ));
          facts.targetWritable = false;
        }
      } else if (objectType.kind === "list") {
        this.host.requireAssignable(indexType, numberType, target.index.span);
        facts.targetType = objectType.element;
        this.host.lowering.collectionIndexes.set(spanIdentity(target.span), "list");
        if (objectType.readonlyView) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot index-assign through ${describeType(objectType)}; it is a read-only view`, target.span));
          facts.targetWritable = false;
        }
      } else if (objectType.kind === "map") {
        this.host.typeError("Use Map.set(key, value) instead of bracket assignment", target.span);
        facts.targetWritable = false;
      } else if (objectType.kind === "record") {
        this.host.requireAssignable(indexType, stringType, target.index.span);
        facts.targetType = objectType.value;
        this.host.lowering.collectionIndexes.set(spanIdentity(target.span), "record");
        if (objectType.readonlyView) {
          this.host.diagnostics.push(diagnostic("VEL3002", `Cannot index-assign through ${describeType(objectType)}; it is a read-only view`, target.span));
          facts.targetWritable = false;
        }
        if (operator !== "=") {
          this.host.typeError("Record keys may be absent; read and check the value before a compound assignment", target.span);
          facts.targetWritable = false;
        }
      } else {
        this.host.typeError(`Cannot index-assign ${describeType(objectType)}`, target.span);
        facts.targetWritable = false;
      }
  }

  private primitiveFieldWritable(name: string, field: string): boolean {
    const pending = [name];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (this.host.primitiveMutableFields.get(current)?.has(field)) return true;
      for (const parent of this.host.primitiveParents.get(current) ?? []) pending.push(parent);
    }
    return false;
  }
}
