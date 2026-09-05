/**
 * The literal expressions: a List literal and a record literal, what their
 * elements and fields are judged against, and the spreads inside them.
 *
 * D115 §三: this was `inferList`, `inferObject` and the two helpers they write
 * the semantic index through. They are the two positions where a contextual
 * type does the most work, so they sit next to `./contextual.ts` rather than
 * inside it.
 */
import { type Expression } from "../../ast.ts";
import { type Diagnostic, type DiagnosticFix, diagnostic } from "../../diagnostic.ts";
import { bindingNameRestriction } from "../../source-names.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type ValueType,
  describeType,
  isInvalidType,
  isReadonlyView,
  mergeTypes,
  nonOptional,
  unknownType,
} from "../../types.ts";
import { uniqueNearestName } from "../nearest-names.ts";
import { type Binding, type MutableCellTarget } from "../scopes.ts";

/** What the literal expressions asks of the analyzer that hosts it, and nothing more. */
export interface LiteralExpressionsHost {
  adviseManualMappedRecordProjection(expression: Extract<Expression, { kind: "ObjectExpression" }>, target: ValueType | null, writtenTarget: ValueType): void;
  adviseManualRecordProjection(expression: Extract<Expression, { kind: "ObjectExpression" }>, target: ValueType | null, writtenTarget: ValueType): void;
  adviseRedundantObjectProperty(property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" }): void;
  adviseTupleShapedListLiteral(expression: Extract<Expression, { kind: "ListExpression" }>, contextualType: ValueType, writtenElementTypes: readonly ValueType[], element: ValueType): void;
  readonly contextualAssignments: Map<string, ValueType>;
  contextualCollectionType(type: ValueType): Extract<ValueType, { kind: "list" | "map" | "set" }> | null;
  contextualObjectType(type: ValueType, expression?: Extract<Expression, { kind: "ObjectExpression" }>): Extract<ValueType, { kind: "named" | "object" | "record" }> | null;
  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean;
  readonly diagnostics: Diagnostic[];
  readonly extensionReservedBindings: Set<string>;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  lookup(name: string): Binding | null;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  readonly semanticExpressionContextMembers: Map<string, ReadonlyMap<string, ValueType>>;
  readonly semanticExpressionContexts: Map<string, ValueType>;
  semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType>;
  readonly semanticObjectPropertyOwners: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  widenAggregateSingleton(type: ValueType): ValueType;
}

export class LiteralExpressions {
  private readonly host: LiteralExpressionsHost;

  constructor(host: LiteralExpressionsHost) {
    this.host = host;
  }

  inferList(expression: Extract<Expression, { kind: "ListExpression" }>, contextualType: ValueType): ValueType {
      const collectionContext = this.host.contextualCollectionType(contextualType);
      let element = unknownType;
      const expectedElement = collectionContext?.kind === "list" ? collectionContext.element : unknownType;
      let matchesContext = collectionContext?.kind === "list";
      const writtenElementTypes: ValueType[] = [];
      for (const item of expression.elements) {
        const inferredItem = this.host.inferExpression(item, expectedElement);
        if (item.kind !== "SpreadExpression") writtenElementTypes.push(inferredItem);
        // D68 rule 177: `[...bag]` spreads what `@iterate:` answers, exactly
        // as `[...bag.items]` would — including the refusal when the answer
        // is not a List, which is the same refusal the field would get.
        const itemType = item.kind === "SpreadExpression" ? this.host.iterationSource(item.value, inferredItem) : inferredItem;
        if (item.kind === "SpreadExpression") {
          if (itemType.kind === "list") {
            const spreadElement = itemType.readonlyView ? this.host.readonlyDataViewOf(itemType.element) : itemType.element;
            element = mergeTypes(element, spreadElement);
            if (expectedElement.kind !== "unknown") {
              if (!this.host.isAssignableHere(spreadElement, expectedElement)) matchesContext = false;
              this.host.requireAssignable(spreadElement, expectedElement, item.span);
            }
          }
          else if (itemType.kind === "enumObject") this.host.typeError(`Cannot spread the enum itself; spread its member List instead — [...${itemType.name}.values()]`, item.span);
          else if (itemType.kind !== "any") this.host.typeError(`Cannot spread ${describeType(itemType)} into a list${this.host.iterationGuidance(itemType)}`, item.span);
        } else {
          element = mergeTypes(element, expectedElement.kind === "unknown" ? this.host.widenAggregateSingleton(itemType) : itemType);
          if (expectedElement.kind !== "unknown") {
            if (!this.host.contextuallyAssignable(itemType, expectedElement, item.span)) matchesContext = false;
            this.host.requireAssignable(itemType, expectedElement, item.span);
          }
        }
      }
      const inferredList: ValueType = { kind: "list", element };
      this.host.adviseTupleShapedListLiteral(expression, contextualType, writtenElementTypes, element);
      if (matchesContext && collectionContext?.kind === "list") {
        return collectionContext;
      }
      return inferredList;
  }

  inferObject(expression: Extract<Expression, { kind: "ObjectExpression" }>, contextualType: ValueType): ValueType {
      const diagnosticsBefore = this.host.diagnostics.length;
      const objectContext = this.host.contextualObjectType(contextualType, expression);
      if (objectContext?.kind === "named") {
        const contextKey = spanIdentity(expression.span);
        this.host.semanticExpressionContexts.set(contextKey, objectContext);
        this.host.semanticExpressionContextMembers.set(contextKey, this.host.semanticMembersOf(objectContext));
      }
      const fields = new Map<string, ValueType>();
      const optionalFields = new Set<string>();
      const explicitFields = new Set<string>();
      let containsSpread = false;
      const expectedRecordValue = objectContext?.kind === "record" ? objectContext.value : null;
      const expectedFields = objectContext?.kind === "object"
        ? objectContext.fields
        : objectContext?.kind === "named" ? this.host.fieldsOf(objectContext.identity ?? objectContext.name) : null;
      const expectedOptionalFields = objectContext?.kind === "object" ? objectContext.optionalFields : undefined;
      for (const property of expression.properties) {
        if (property.kind === "ObjectProperty") {
          if (explicitFields.has(property.name)) {
            this.host.diagnostics.push(diagnostic("VEL4004", `Object field '${property.name}' is declared more than once`, property.span));
          }
          explicitFields.add(property.name);
          optionalFields.delete(property.name);
          if (this.checkShorthandReservedName(property)) {
            fields.set(property.name, unknownType);
            continue;
          }
          if (objectContext?.kind === "named" && expectedFields?.has(property.name)) {
            this.host.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, objectContext);
          }
          // D90 R11: a literal written at a type-annotated position is
          // closed. Every one of its keys is in front of the compiler here,
          // so an unrecognised one is a misspelling rather than a value that
          // happens to be wider — which is why the openness a non-literal
          // keeps is untouched. Only written keys are checked, so a spread's
          // surplus fields stay legal and this sits outside the
          // missing-field guard below rather than inside it. A `Record<T>`
          // context declares every string key, and leaves `expectedFields`
          // null, so no key of one is ever unrecognised.
          if (objectContext && expectedFields && !expectedFields.has(property.name)) {
            const nearest = uniqueNearestName(property.name, expectedFields.keys());
            const owner = objectContext.kind === "named" ? `Type '${objectContext.name}'` : "Object";
            this.host.typeError(
              `${owner} has no field '${property.name}'${nearest ? `; did you mean '${nearest}'?` : ""}`,
              property.span,
            );
          }
          const expected = expectedFields?.get(property.name) ?? expectedRecordValue ?? unknownType;
          const actual = this.host.inferExpression(property.value, expected.kind === "optional" ? expected.inner : expected);
          fields.set(property.name, expected.kind === "unknown" ? this.host.widenAggregateSingleton(actual) : actual);
          if (expected.kind !== "unknown") this.host.requireAssignable(actual, expected, property.value.span);
          this.host.adviseRedundantObjectProperty(property);
        } else {
          containsSpread = true;
          const spread = this.host.inferExpression(property.value);
          // COL-D2: spreading a named (open) record into a Record<T>
          // context smuggles undeclared fields past the value contract —
          // the exact reason the direct assignment is rejected — so the
          // spread spelling is rejected the same way, teaching explicit
          // field copies.
          if (expectedRecordValue && spread.kind === "named" && this.host.fieldsOf(spread.identity ?? spread.name)) {
            const declaredFields = [...this.host.fieldsOf(spread.identity ?? spread.name)!.keys()];
            const example = declaredFields.slice(0, 2).map((field) => `${field}: value.${field}`).join(", ") + (declaredFields.length > 2 ? ", ..." : "");
            this.host.typeError(
              `Cannot spread ${describeType(spread)} into a Record value: a named record is open, so the value may carry fields beyond its declaration; copy the declared fields explicitly — {${example}}`,
              property.span,
            );
            continue;
          }
          const spreadFields = spread.kind === "object" ? spread.fields : spread.kind === "named" ? this.host.fieldsOf(spread.identity ?? spread.name) : null;
          if (spreadFields) {
            for (const [name, type] of spreadFields) {
              const readonly = isReadonlyView(spread)
                || spread.kind === "object" && spread.readonlyFields?.has(name) === true
                || spread.kind === "named" && this.host.readonlyFieldsOf(spread.identity ?? spread.name)?.has(name) === true;
              const shared = readonly ? this.host.readonlyDataViewOf(type) : type;
              if (expectedRecordValue) this.host.requireAssignable(shared, expectedRecordValue, property.span);
              const alreadyRequired = fields.has(name) && !optionalFields.has(name);
              fields.set(name, shared);
              if (!alreadyRequired && spread.kind === "object" && spread.optionalFields?.has(name)) optionalFields.add(name);
              else optionalFields.delete(name);
            }
          } else if (spread.kind === "record" && expectedRecordValue) {
            this.host.requireAssignable(spread.value, expectedRecordValue, property.span);
          } else if (spread.kind !== "any" && !isInvalidType(spread)) {
            this.host.typeError(`Cannot spread ${describeType(spread)} into an object`, property.span);
          }
        }
      }
      if (expectedFields && !containsSpread) {
        for (const [name, expected] of expectedFields) {
          if (!explicitFields.has(name) && expected.kind !== "optional" && !expectedOptionalFields?.has(name)) {
            this.host.typeError(`Object is missing required field '${name}'`, expression.span);
          }
        }
        this.host.contextualAssignments.set(spanIdentity(expression.span), contextualType);
      }
      if (this.host.diagnostics.length === diagnosticsBefore) {
        this.host.adviseManualRecordProjection(expression, objectContext, contextualType);
        this.host.adviseManualMappedRecordProjection(expression, objectContext, contextualType);
      }
      return expectedRecordValue
        ? { kind: "record", value: expectedRecordValue }
        : { kind: "object", fields, ...(optionalFields.size > 0 ? { optionalFields } : {}) };
  }

  /**
   * A record shorthand names a binding. Reserved names have no binding to name,
   * so `{computed}` and `{print}` used to reach past the author entirely and
   * capture the runtime entry point. The shorthand is refused with the explicit
   * spelling, which is the only way to mean either thing on purpose — and it
   * puts the reserved names on the same footing as every softened word, whose
   * shorthand now resolves to an ordinary binding.
   */
  private checkShorthandReservedName(property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" }): boolean {
    if (!property.shorthand || this.host.lookup(property.name)) return false;
    const restriction = bindingNameRestriction(property.name, this.host.extensionReservedBindings);
    if (restriction !== "core" && restriction !== "extension" && restriction !== "javascript") return false;
    const owner = restriction === "core" ? "reserved Core binding" : restriction === "extension" ? "reserved extension binding" : "name JavaScript reserves";
    this.host.diagnostics.push(diagnostic(
      "VEL3007",
      `Write '${property.name}: value'; '${property.name}' is a ${owner}, so the shorthand has no binding of that name to read`,
      property.span,
    ));
    return true;
  }

  recordRuntimeObjectShape(expression: Extract<Expression, { kind: "ObjectExpression" }>, owner: Extract<ValueType, { kind: "named" }>): void {
    const fields = this.host.fieldsOf(owner.identity ?? owner.name);
    if (!fields) return;
    for (const property of expression.properties) {
      if (property.kind !== "ObjectProperty") continue;
      const field = fields.get(property.name);
      if (!field) continue;
      this.host.semanticObjectPropertyOwners.set(`${property.span.start}:${property.name}`, owner);
      const nested = nonOptional(field);
      if (property.value.kind === "ObjectExpression" && nested.kind === "named") {
        this.recordRuntimeObjectShape(property.value, nested);
      }
    }
  }
}
