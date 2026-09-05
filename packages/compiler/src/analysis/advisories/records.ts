/**
 * A9, A10 and A15: a record literal that mirrors another record field by
 * field, applies one transform to every field, or repeats a name it could have
 * written once.
 *
 * D115 §三 / D114 R1f: one family of `advisories.ts`.
 */
import { type Expression } from "../../ast.ts";
import { span } from "../../source.ts";
import { sameType, type ValueType } from "../../types.ts";
import { type AdvisoryHost } from "./roster.ts";

export class RecordAdvisories {
  private readonly host: AdvisoryHost;

  constructor(host: AdvisoryHost) {
    this.host = host;
  }

  /**
   * A9: a closed target literal that merely mirrors the same record field by
   * field has the exact projection spelling `Target.from(source, overrides)`.
   *
   * This is intentionally narrower than a visual resemblance check. An
   * override call could mutate the source before a later manual field read,
   * so the advisory requires every target field, two or more same-name data
   * reads from one identifier, and only identifiers or literals for the
   * remaining fields. Optional omissions, computed values, calls, spreads,
   * and mixed sources all remain ordinary object literals. Authored key order
   * may differ: the report calls out that `.from` deliberately canonicalizes
   * the result to target declaration order, so an intentional wire order has
   * one honest reason to suppress it.
   */
  adviseManualRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.host.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (properties.length !== targetFields.length || targetFields.some((name) => !properties.some((property) => property.name === name))) return;

    let sourceName: string | null = null;
    let mirrors = 0;
    const overrides: string[] = [];
    for (const property of properties) {
      const value = property.value;
      if (value.kind === "MemberExpression"
        && !value.optional
        && value.object.kind === "IdentifierExpression"
        && value.property === property.name
        && this.host.stableDataMember(value.object, value.property)) {
        if (sourceName !== null && sourceName !== value.object.name) return;
        sourceName = value.object.name;
        mirrors += 1;
        continue;
      }
      if (value.kind === "IdentifierExpression") {
        overrides.push(value.name === property.name ? property.name : `${property.name}: ${value.name}`);
        continue;
      }
      if (value.kind === "LiteralExpression") {
        overrides.push(`${property.name}: ${value.raw}`);
        continue;
      }
      return;
    }
    if (sourceName === null || mirrors < 2) return;
    const sourceBinding = this.host.lookup(sourceName);
    if (!sourceBinding || !this.host.recordProjectionShape(sourceBinding.type)) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.from(${sourceName}${overrides.length > 0 ? `, {${overrides.join(", ")}}` : ""})`;
    this.host.advise(
      "A9",
      `This ${targetName} literal mirrors ${mirrors} same-name fields from '${sourceName}'; '${replacement}' is the canonical exact projection and keeps ${targetName}'s declared field set and declaration order. Write that instead of copying the fields one by one; suppress A9 only when this literal's authored Record order is intentional`,
      expression.span,
      this.host.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.from(...)'`,
      ),
    );
  }

  /**
   * A10: a large closed record literal that applies one transform to every
   * same-name field is the long form of `Target.mapFrom(source, transform)`.
   *
   * Four fields is the deliberately conservative threshold: below it the
   * literal is often clearer, while a larger block is maintenance-heavy and
   * likely to drift. Because the transform may have effects, this proof also
   * requires authored property order to equal target declaration order.
   */
  adviseManualMappedRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    if (target?.kind !== "named") return;
    const shape = this.host.recordProjectionShape(target);
    if (!shape || expression.properties.some((property) => property.kind !== "ObjectProperty")) return;
    const properties = expression.properties as readonly Extract<(typeof expression.properties)[number], { kind: "ObjectProperty" }>[];
    const targetFields = [...shape.fields.keys()];
    if (targetFields.length < 4 || properties.length !== targetFields.length) return;
    if (properties.some((property, index) => property.name !== targetFields[index])) return;

    let sourceName: string | null = null;
    let transformName: string | null = null;
    for (const property of properties) {
      const value = property.value;
      if (value.kind !== "CallExpression"
        || value.optional
        || value.callee.kind !== "IdentifierExpression"
        || value.arguments.length !== 1
        || value.argumentNames?.some((name) => name !== null)) return;
      const argument = value.arguments[0];
      if (!argument || argument.kind !== "MemberExpression"
        || argument.optional
        || argument.object.kind !== "IdentifierExpression"
        || argument.property !== property.name
        || !this.host.stableDataMember(argument.object, argument.property)) return;
      if (sourceName !== null && sourceName !== argument.object.name) return;
      if (transformName !== null && transformName !== value.callee.name) return;
      sourceName = argument.object.name;
      transformName = value.callee.name;
    }
    if (sourceName === null || transformName === null) return;
    const sourceBinding = this.host.lookup(sourceName);
    const transformBinding = this.host.lookup(transformName);
    if (!sourceBinding || !this.host.recordProjectionShape(sourceBinding.type)) return;
    const transformType = transformBinding ? this.host.expandAliases(transformBinding.type) : null;
    if (!transformType || (transformType.kind !== "function" && transformType.kind !== "action")) return;

    const targetName = this.recordProjectionTypeName(target, writtenTarget);
    const replacement = `${targetName}.mapFrom(${sourceName}, ${transformName})`;
    this.host.advise(
      "A10",
      `This ${targetName} literal repeats '${transformName}(${sourceName}.field)' for all ${targetFields.length} fields; '${replacement}' maps the complete target field table in declaration order. Write that instead of maintaining one conversion per field`,
      expression.span,
      this.host.commentPreservingMechanicalFix(
        expression.span,
        replacement,
        `Use '${targetName}.mapFrom(...)'`,
      ),
    );
  }

  /** Returns a name that is legal in the Type-object position of the fix. */
  private recordProjectionTypeName(target: Extract<ValueType, { kind: "named" }>, writtenTarget: ValueType): string {
    if (writtenTarget.kind === "named" && this.host.lookup(writtenTarget.name)?.type.kind === "typeObject") {
      return writtenTarget.name;
    }
    for (const [name, alias] of this.host.typeAliases) {
      if (sameType(this.host.expandAliases(alias), target)) return name;
    }
    return target.name;
  }

  /**
   * A15: `{name: name}` and `{name}` are the same record entry when both
   * occurrences are ordinary identifiers. Quoted and keyword-named keys are
   * deliberately excluded: the AST keeps their decoded value, so comparing
   * names alone would erase syntax the author actually wrote. Parenthesized,
   * member, call, and every different-name value remain ordinary mappings.
   *
   * The edit owns only the entry, never its comma or surrounding layout. A
   * comment between the key and value withholds the edit rather than dropping
   * prose; a trailing comment sits outside the entry span and is preserved.
   */
  adviseRedundantObjectProperty(
    property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" },
  ): void {
    if (!property.sameNameIdentifierValue) return;
    this.host.advise(
      "A15",
      `Object field '${property.name}' repeats the same-name identifier it reads; use the shorthand '{${property.name}}'`,
      property.span,
      this.host.commentPreservingMechanicalFix(property.span, property.name, `Use object shorthand '${property.name}'`),
    );
  }
}
