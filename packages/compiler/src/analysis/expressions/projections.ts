/**
 * `Target.from(source, {overrides})` and `Target.mapFrom(list, {overrides})` —
 * D95's exact record projection, in both its single-value and its mapped form.
 *
 * D115 §三: these were two 147- and 145-line private methods of `Analyzer` and
 * the shape helper both read. Each keeps its prologue — resolve the target,
 * plan the arguments, type the source — and hands the two long tails to a named
 * step, so no step is longer than a screen and the order the steps run in is
 * the order the one method ran them in.
 */
import { type AdvisoryRecordShape } from "../advisories.ts";
import { type Expression } from "../../ast.ts";
import { type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type ValueType,
  describeType,
  invalidType,
  isInvalidType,
  optionalOf,
  sameType,
  unionOf,
  unknownType,
} from "../../types.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/** What the record projections asks of the analyzer that hosts it, and nothing more. */
export interface RecordProjectionsHost {
  readonly callExpressionCallees: Set<string>;
  concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType;
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  lookup(name: string): Binding | null;
  readonly lowering: LoweringRecorder;
  planNamedArguments( arguments_: readonly Expression[], argumentNames: readonly (string | null)[] | undefined, parameters: readonly ValueType[], parameterNames: readonly string[] | undefined, requiredParameters: number, callSpan: Span, rest?: ValueType, ): { readonly ordered: readonly Expression[]; readonly targets: readonly (number | null)[]; readonly valid: boolean; } | null;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordSemanticExpression(expression: Expression, type: ValueType): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  readonly semanticExpressionOwners: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class RecordProjections {
  private readonly host: RecordProjectionsHost;

  constructor(host: RecordProjectionsHost) {
    this.host = host;
  }

  /**
   * A concrete record Type owns one compiler-only constructor:
   *
   *     Response.from(source, {worldId})
   *
   * The source is already typed; this is not validation and therefore never
   * accepts unknown/any. The target field table is the authority. Overrides
   * must be a literal so every exception to same-name projection is visible
   * to the analyzer, and lowering can copy only declared target fields without
   * exposing an open source record's surplus runtime data.
   */
  inferRecordFromCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    if (member.property !== "from" || member.optional || member.object.kind !== "IdentifierExpression") return null;
    const binding = this.host.lookup(member.object.name);
    if (binding?.type.kind !== "typeObject") return null;
    const diagnosticsBefore = this.host.diagnostics.length;

    this.host.callExpressionCallees.add(spanIdentity(member.span));
    const receiver = this.host.inferExpression(member.object);
    if (isInvalidType(receiver) || receiver.kind !== "typeObject") {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return invalidType;
    }

    const target = this.host.runtimeTypeObjectValue(receiver);
    const targetShape = this.recordProjectionShape(target);
    const callable: ValueType = {
      kind: "function",
      parameterNames: ["source", "overrides"],
      parameters: [unknownType, unknownType],
      requiredParameters: 1,
      result: target,
    };
    this.host.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, receiver);
    this.host.recordSemanticExpression(member, callable);
    if (!targetShape) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(
        `Type '${receiver.name}' is not a concrete record, so it cannot use '.from'; declare a record type whose fields define the projection`,
        member.span,
      );
      return invalidType;
    }

    const named = this.host.planNamedArguments(
      sourceArguments,
      argumentNames,
      [unknownType, unknownType],
      ["source", "overrides"],
      1,
      callSpan,
    );
    if (named && !named.valid) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return target;
    }
    if (!named && (sourceArguments.length < 1 || sourceArguments.length > 2)) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(`Expected 1-2 arguments but received ${sourceArguments.length}`, callSpan);
      return target;
    }

    const ordered = named?.ordered ?? sourceArguments;
    const omitted = (expression: Expression | undefined): boolean => expression?.kind === "IdentifierExpression"
      && expression.name === "\u0000omitted-named-argument";
    const sourceExpression = ordered[0];
    const overridesExpression = omitted(ordered[1]) ? undefined : ordered[1];
    if (!sourceExpression || omitted(sourceExpression)) return target;
    if (sourceExpression.kind === "SpreadExpression") {
      this.host.inferExpression(sourceExpression.value);
      if (overridesExpression) this.host.inferExpression(overridesExpression.kind === "SpreadExpression" ? overridesExpression.value : overridesExpression);
      this.host.typeError("A record projection takes one source value; call spread cannot decide that source", sourceExpression.span);
      return target;
    }

    const source = this.host.inferExpression(sourceExpression);
    const sourceShape = this.recordProjectionShape(source);
    if (!isInvalidType(source) && (source.kind === "unknown" || source.kind === "any")) {
      this.host.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; validate untrusted data with 'Type.parse' before projecting a typed record`,
        sourceExpression.span,
      );
    } else if (!isInvalidType(source) && !sourceShape) {
      this.host.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; '.from' requires a typed record source`,
        sourceExpression.span,
      );
    }

    const overridden = this.projectionOverrides(overridesExpression, target, targetShape);
    this.checkProjectedFields(target, source, sourceExpression, targetShape, sourceShape, overridden);
    if (this.host.diagnostics.length === diagnosticsBefore) {
      this.host.lowering.recordFromCalls.set(spanIdentity(callSpan), {
        target: receiver.name,
        fields: [...targetShape.fields].map(([name, type]) => ({
          name,
          optional: targetShape.optionalFields.has(name) || type.kind === "optional",
        })),
      });
    }
    return target;
  }

  /**
   * A mapped projection keeps the target record's field table as the sole
   * authority while converting every same-name source value with one
   * callback:
   *
   *     RuntimePalette.mapFrom(identityPalette, resolve)
   *
   * This is intentionally a concrete-record operation rather than
   * `Record.map`: the analyzer can prove that every required target field is
   * present, the emitter can preserve target declaration order, and callers
   * retain named-field completion on the returned value.
   */
  inferRecordMapFromCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    if (member.property !== "mapFrom" || member.optional || member.object.kind !== "IdentifierExpression") return null;
    const binding = this.host.lookup(member.object.name);
    if (binding?.type.kind !== "typeObject") return null;
    const diagnosticsBefore = this.host.diagnostics.length;

    this.host.callExpressionCallees.add(spanIdentity(member.span));
    const receiver = this.host.inferExpression(member.object);
    if (isInvalidType(receiver) || receiver.kind !== "typeObject") {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return invalidType;
    }

    const target = this.host.runtimeTypeObjectValue(receiver);
    const targetShape = this.recordProjectionShape(target);
    const callable: ValueType = {
      kind: "function",
      parameterNames: ["source", "transform"],
      parameters: [unknownType, { kind: "function", parameters: [unknownType], requiredParameters: 1, result: unknownType }],
      requiredParameters: 2,
      result: target,
    };
    this.host.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, receiver);
    this.host.recordSemanticExpression(member, callable);
    if (!targetShape) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(
        `Type '${receiver.name}' is not a concrete record, so it cannot use '.mapFrom'; declare a record type whose fields define the mapped projection`,
        member.span,
      );
      return invalidType;
    }

    const named = this.host.planNamedArguments(
      sourceArguments,
      argumentNames,
      [unknownType, unknownType],
      ["source", "transform"],
      2,
      callSpan,
    );
    if (named && !named.valid) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      return target;
    }
    if (!named && sourceArguments.length !== 2) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(`Expected 2 arguments but received ${sourceArguments.length}`, callSpan);
      return target;
    }

    const ordered = named?.ordered ?? sourceArguments;
    const omitted = (expression: Expression | undefined): boolean => expression?.kind === "IdentifierExpression"
      && expression.name === "\u0000omitted-named-argument";
    const sourceExpression = ordered[0];
    const transformExpression = ordered[1];
    if (!sourceExpression || !transformExpression || omitted(sourceExpression) || omitted(transformExpression)) return target;
    if (sourceExpression.kind === "SpreadExpression" || transformExpression.kind === "SpreadExpression") {
      this.host.inferExpression(sourceExpression.kind === "SpreadExpression" ? sourceExpression.value : sourceExpression);
      this.host.inferExpression(transformExpression.kind === "SpreadExpression" ? transformExpression.value : transformExpression);
      this.host.typeError("A mapped record projection does not accept call spreads", callSpan);
      return target;
    }

    const source = this.host.inferExpression(sourceExpression);
    const sourceShape = this.recordProjectionShape(source);
    if (!isInvalidType(source) && (source.kind === "unknown" || source.kind === "any")) {
      this.host.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; validate untrusted data with 'Type.parse' before mapping a typed record`,
        sourceExpression.span,
      );
    } else if (!isInvalidType(source) && !sourceShape) {
      this.host.typeError(
        `Cannot build ${describeType(target)} from ${describeType(source)}; '.mapFrom' requires a typed record source`,
        sourceExpression.span,
      );
    }

    const sourceFieldTypes = this.mappedSourceFieldTypes(target, source, sourceExpression, targetShape, sourceShape);
    this.checkMappedTransform(target, targetShape, sourceFieldTypes, transformExpression);
    if (this.host.diagnostics.length === diagnosticsBefore) {
      this.host.lowering.recordMapFromCalls.set(spanIdentity(callSpan), {
        target: receiver.name,
        fields: [...targetShape.fields].map(([name, type]) => ({
          name,
          optional: targetShape.optionalFields.has(name) || type.kind === "optional",
        })),
      });
    }
    return target;
  }

  /**
   * The fields an explicit overrides literal replaces, and the four refusals a
   * literal that cannot be read as one earns. D115 §三 split this out of
   * `inferRecordFromCall`; the checks and their order are unchanged.
   */
  private projectionOverrides(
    overridesExpression: Expression | undefined,
    target: ValueType,
    targetShape: AdvisoryRecordShape,
  ): ReadonlySet<string> {
    const overridden = new Set<string>();
    if (overridesExpression) {
      if (overridesExpression.kind === "SpreadExpression") {
        this.host.inferExpression(overridesExpression.value);
        this.host.typeError("Record projection overrides must be one explicit record literal, not a call spread", overridesExpression.span);
      } else if (overridesExpression.kind !== "ObjectExpression") {
        this.host.inferExpression(overridesExpression);
        this.host.typeError(
          `Overrides for ${describeType(target)}.from must be a record literal so every replacement field is visible`,
          overridesExpression.span,
        );
      } else {
        for (const property of overridesExpression.properties) {
          if (property.kind === "ObjectSpread") {
            this.host.typeError(
              `Overrides for ${describeType(target)}.from must name fields explicitly; an override spread can hide extra or misspelled fields`,
              property.span,
            );
          } else {
            overridden.add(property.name);
          }
        }
        this.host.inferExpression(overridesExpression, {
          kind: "object",
          fields: targetShape.fields,
          optionalFields: new Set(targetShape.fields.keys()),
        });
      }
    }

    return overridden;
  }

  /**
   * Every target field the source has to fill, and what it is refused for.
   * D115 §三 split this out of `inferRecordFromCall`; the checks and their
   * order are unchanged.
   */
  private checkProjectedFields(
    target: ValueType,
    source: ValueType,
    sourceExpression: Expression,
    targetShape: AdvisoryRecordShape,
    sourceShape: AdvisoryRecordShape | null,
    overridden: ReadonlySet<string>,
  ): void {
    if (sourceShape) {
      for (const [name, expected] of targetShape.fields) {
        if (overridden.has(name)) continue;
        let actual = sourceShape.fields.get(name);
        if (!actual) {
          if (targetShape.optionalFields.has(name)) continue;
          this.host.typeError(
            `${describeType(target)}.from cannot fill required field '${name}' from ${describeType(source)}; provide '${name}' in the overrides literal`,
            sourceExpression.span,
          );
          continue;
        }
        if (sourceShape.optionalFields.has(name) && actual.kind !== "optional") actual = optionalOf(actual);
        if (sourceShape.readonlyFields.has(name) || sourceShape.readonlyView) actual = this.host.readonlyDataViewOf(actual);
        if (!this.host.isAssignableHere(actual, expected)) {
          this.host.typeError(
            `${describeType(target)}.from cannot fill field '${name}': ${describeType(source)} provides ${describeType(actual)}, but the target requires ${describeType(expected)}; override '${name}' explicitly`,
            sourceExpression.span,
          );
        }
      }
    }

  }

  /**
   * The source-side types a mapped projection's transform has to accept, and
   * the refusals a field the source cannot supply earns. D115 §三 split this
   * out of `inferRecordMapFromCall`; the checks and their order are unchanged.
   */
  private mappedSourceFieldTypes(
    target: ValueType,
    source: ValueType,
    sourceExpression: Expression,
    targetShape: AdvisoryRecordShape,
    sourceShape: AdvisoryRecordShape | null,
  ): ValueType[] {
    const sourceFieldTypes: ValueType[] = [];
    if (sourceShape) {
      for (const [name] of targetShape.fields) {
        let actual = sourceShape.fields.get(name);
        if (!actual) {
          if (targetShape.optionalFields.has(name)) continue;
          this.host.typeError(
            `${describeType(target)}.mapFrom cannot fill required field '${name}' from ${describeType(source)}`,
            sourceExpression.span,
          );
          continue;
        }
        if (sourceShape.optionalFields.has(name) && !targetShape.optionalFields.has(name)) {
          this.host.typeError(
            `${describeType(target)}.mapFrom cannot fill required field '${name}' from optional field '${name}' on ${describeType(source)}`,
            sourceExpression.span,
          );
        }
        if (sourceShape.optionalFields.has(name) && actual.kind !== "optional") actual = optionalOf(actual);
        if (sourceShape.readonlyFields.has(name) || sourceShape.readonlyView) actual = this.host.readonlyDataViewOf(actual);
        sourceFieldTypes.push(actual);
      }
    }

    return sourceFieldTypes;
  }

  /**
   * The transform itself: the contract it is judged against, and the target
   * field types its result has to satisfy. D115 §三 split this out of
   * `inferRecordMapFromCall`; the checks and their order are unchanged.
   */
  private checkMappedTransform(
    target: ValueType,
    targetShape: AdvisoryRecordShape,
    sourceFieldTypes: readonly ValueType[],
    transformExpression: Expression,
  ): void {
    const sourceFieldType = unionOf(sourceFieldTypes);
    const transformExpected: ValueType = {
      kind: "function",
      parameters: [sourceFieldType],
      parameterNames: ["value"],
      requiredParameters: 1,
      result: unknownType,
    };
    const transform = this.host.concreteCallableFor(
      this.host.inferExpression(transformExpression, transformExpected),
      transformExpected,
      transformExpression.span,
    );
    this.host.requireAssignable(transform, transformExpected, transformExpression.span);
    const result = transform.kind === "function" ? transform.result : unknownType;
    const checkedTargetTypes: ValueType[] = [];
    for (const expected of targetShape.fields.values()) {
      if (checkedTargetTypes.some((existing) => sameType(existing, expected))) continue;
      checkedTargetTypes.push(expected);
      if (!this.host.isAssignableHere(result, expected)) {
        this.host.typeError(
          `${describeType(target)}.mapFrom transform returns ${describeType(result)}, but target fields require ${describeType(expected)}`,
          transformExpression.span,
        );
      }
    }

  }

  recordProjectionShape(type: ValueType): {
    readonly fields: ReadonlyMap<string, ValueType>;
    readonly optionalFields: ReadonlySet<string>;
    readonly readonlyFields: ReadonlySet<string>;
    readonly readonlyView: boolean;
  } | null {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "object") {
      return {
        fields: expanded.fields,
        optionalFields: expanded.optionalFields ?? new Set(),
        readonlyFields: expanded.readonlyFields ?? new Set(),
        readonlyView: expanded.readonlyView === true,
      };
    }
    if (expanded.kind !== "named") return null;
    const identity = expanded.identity ?? expanded.name;
    const fields = this.host.fieldsOf(identity);
    if (!fields) return null;
    return {
      fields,
      optionalFields: new Set([...fields].filter(([, field]) => field.kind === "optional").map(([name]) => name)),
      readonlyFields: this.host.readonlyFieldsOf(identity) ?? new Set(),
      readonlyView: expanded.readonlyView === true,
    };
  }
}
