/**
 * The expression forms that are neither a literal, a call, nor a binary
 * operator: `await` and the other unary operators, `!` (required), `try`, the
 * ternary, `is`, and an index read.
 *
 * D115 §三: these were six private methods of `Analyzer`, each the whole of one
 * arm of the expression dispatcher. They share no state and answer no common
 * question — what they share is that each is one syntactic form's typing rule,
 * which is what this file is.
 */
import { type Expression, type TypeReference } from "../../ast.ts";
import { type Diagnostic, type DiagnosticFix, diagnostic, mechanicalFix } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import {
  type ValueType,
  anyType,
  binaryStorageKind,
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  mergeTypes,
  nonOptional,
  numberType,
  optionalOf,
  resolvedAsyncType,
  stringType,
  unknownType,
} from "../../types.ts";
import { type FlowFactInvalidations, type FlowFactsSnapshot } from "../flow/facts.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type MutableCellTarget } from "../scopes.ts";

/** What the operator expressions asks of the analyzer that hosts it, and nothing more. */
export interface OperatorExpressionsHost {
  allowBareGenericClassName(reference: TypeReference): void;
  analyzeIsolatedFlow(snapshot: FlowFactsSnapshot, analyze: () => void): FlowFactInvalidations;
  applyFlowInvalidations(branches: readonly FlowFactInvalidations[], includeBaseline?: boolean): void;
  readonly asynchronousFunctions: boolean[];
  awaitedOperandContext(contextualType: ValueType): ValueType;
  boundaryValidationGuidance(expression: Expression | null, property: string | null): string;
  readonly classFieldInitializerDepth: number;
  readonly constructorDepth: number;
  readonly contextualAssignments: Map<string, ValueType>;
  contextualObjectType(type: ValueType, expression?: Extract<Expression, { kind: "ObjectExpression" }>): Extract<ValueType, { kind: "named" | "object" | "record" }> | null;
  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean;
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly functionDepth: number;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferNarrowedExpression(expression: Expression, narrowed: ReadonlyMap<string, ValueType>, contextualType: ValueType): ValueType;
  invalidExtensionAwaitContext(): boolean;
  invalidExtensionAwaitMessage(): string | null;
  readonly lowering: LoweringRecorder;
  narrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  negativeNarrowingFor(expression: Expression, knownType?: ValueType): ReadonlyMap<string, ValueType>;
  optionalExecutionNarrowings(expression: Expression): ReadonlyMap<string, ValueType>;
  readonly parameterDefaultDepth: number;
  readonlyDataViewOf(type: ValueType): ValueType;
  rejectDisjointEnumTest(subjectSource: ValueType, checked: ValueType, operator: "is" | "is not", span: Span): void;
  rejectErasedRuntimeCheck(checked: ValueType, errorSpan: Span): boolean;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  requireCondition(type: ValueType, condition: Expression): void;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  snapshotFlowFacts(): FlowFactsSnapshot;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
  withTemporaryNarrowings<T>( narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span, analyze: () => T, ): T;
}

export class OperatorExpressions {
  private readonly host: OperatorExpressionsHost;

  constructor(host: OperatorExpressionsHost) {
    this.host = host;
  }

  inferUnary(expression: Extract<Expression, { kind: "UnaryExpression" }>, contextualType: ValueType): ValueType {
      // D114 item ①: `await` adds no position of its own, it passes the
      // enclosing one through. The awaited operand is matched against
      // `Promise` of what the position expects — the only shape an operand
      // of `await` could have produced that value with — so `const rows:
      // List<string> = await loadAll(url)` solves the call's `T` exactly as
      // the unawaited spelling does. `try` is transparent the same way
      // already (its operand takes the non-optional part of the position)
      // and parentheses carry no node at all, so `try await (...)` composes
      // without any of the three knowing about the others.
      const operand = this.host.inferExpression(
        expression.operand,
        expression.operator === "await" ? this.host.awaitedOperandContext(contextualType) : unknownType,
      );
      if (expression.operator === "await") {
        if (this.host.parameterDefaultDepth > 0) {
          this.host.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a parameter default value", expression.span));
        } else if (this.host.classFieldInitializerDepth > 0) {
          this.host.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used in a class field initializer", expression.span));
        } else if (this.host.constructorDepth > 0) {
          this.host.diagnostics.push(diagnostic("VEL4007", "'await' cannot be used directly in a constructor", expression.span));
        }
        const invalidFunctionAwait = this.host.functionDepth > 0 && !this.host.asynchronousFunctions.at(-1);
        const invalidExtensionAwait = this.host.functionDepth === 0 && this.host.invalidExtensionAwaitContext();
        if (this.host.parameterDefaultDepth === 0 && this.host.constructorDepth === 0 && (invalidFunctionAwait || invalidExtensionAwait)) {
          this.host.diagnostics.push(diagnostic(
            "VEL4007",
            // D90 R18: an `@iterate:` block that awaits is the asynchronous
            // pull form, so awaiting inside one is never refused here — the
            // form's own validation owns the answer-shape question.
            invalidExtensionAwait
              ? this.host.invalidExtensionAwaitMessage() ?? "'await' is not valid in this synchronous extension context"
              : "'await' can only be used in an async function or at module scope",
            expression.span,
          ));
        }
        const awaited = this.host.expandAliases(operand);
        if (isInvalidType(awaited)) return invalidType;
        if (awaited.kind === "promise") {
          this.host.reportPromiseResolutionHazard(awaited.value, expression.operand.span);
          const result = resolvedAsyncType(awaited.value);
          if (result.kind === "null" && !this.host.lowering.normalizedPromiseValues.has(spanIdentity(expression.operand.span))) {
            this.host.lowering.normalizedNullResults.add(spanIdentity(expression.span));
          }
          return result;
        }
        // ASY-U2 + D90 R17: awaiting an unchecked boundary value adopts a
        // foreign thenable — its hooks run here and a raw undefined result
        // skips null normalization — so `any` and `unknown` share one
        // refusal, and it teaches the way in: a declared contract.
        this.host.typeError(
          awaited.kind === "any" || awaited.kind === "unknown"
            ? `Cannot await ${describeType(operand)}; an unchecked thenable runs foreign hooks and can leak raw undefined — declare the source in an extern contract so the result is a checked Promise, or validate the resolved data at the edge with 'Type.parse'`
            : `Cannot await ${describeType(operand)}`,
          expression.span,
        );
        return unknownType;
      }
      if (isInvalidType(operand)) return invalidType;
      if (expression.operator === "not") {
        this.host.requireCondition(operand, expression.operand);
        return boolType;
      }
      this.host.requireAssignable(operand, numberType, expression.operand.span);
      return numberType;
  }

  inferRequired(expression: Extract<Expression, { kind: "RequiredExpression" }>, contextualType: ValueType): ValueType {
      // D86 rule 212: `value!` answers "absent here is a bug", so it takes
      // `T?` to `T` and has nothing to say about a value that already holds
      // one. The contextual type is the optional of what the consumer wants,
      // since the unwrap is what removes the question.
      const value = this.host.inferExpression(expression.value, optionalOf(this.host.expandAliases(contextualType)));
      if (isInvalidType(value)) return invalidType;
      const resolved = this.host.expandAliases(value);
      if (resolved.kind === "any") return value;
      if (resolved.kind === "optional") return resolved.inner;
      const message = resolved.kind === "unknown"
        ? `'!' unwraps an optional, and ${describeType(value)} is not one; validate it with 'is' or 'parse' before reading it`
        : resolved.kind === "promise"
          // The same mistake `try` guards against: the unwrap reached the
          // Promise rather than the value it resolves to.
          ? `'!' unwraps an optional, and this expression is ${describeType(value)}; write '(await ...)!' so the unwrap reaches the resolved value`
          : `'!' unwraps an optional, and this value is already ${describeType(value)}; remove the '!'`;
      this.host.diagnostics.push(diagnostic(
        "VEL4040",
        message,
        expression.span,
        ...(resolved.kind === "unknown" || resolved.kind === "promise"
          ? []
          : [mechanicalFix({ start: expression.span.end - 1, end: expression.span.end }, "", "Remove the redundant '!'")]),
      ));
      return value;
  }

  inferTry(expression: Extract<Expression, { kind: "TryExpression" }>, contextualType: ValueType): ValueType {
      // D39 item 51: an expected failure is an optional. The inner
      // expression is checked against the non-optional shape of whatever the
      // consumer wants, because failure is what supplies the null.
      if (expression.value.kind === "TryExpression") {
        this.host.diagnostics.push(diagnostic(
          "VEL4034",
          "'try try' says nothing the first 'try' has not already said; one 'try' turns any failure in the whole chain into null",
          expression.span,
        ));
      }
      const attempted = this.host.inferExpression(expression.value, nonOptional(this.host.expandAliases(contextualType)));
      if (isInvalidType(attempted)) return invalidType;
      const resolved = this.host.expandAliases(attempted);
      if (resolved.kind === "null") {
        this.host.diagnostics.push(diagnostic(
          "VEL4034",
          "This expression produces null on success, so a 'try' result cannot tell success from failure; use try/catch to handle the failure",
          expression.span,
        ));
        return invalidType;
      }
      if (resolved.kind === "promise") {
        this.host.diagnostics.push(diagnostic(
          "VEL4034",
          `'try' catches a failure while the expression runs, but this expression is ${describeType(attempted)}; write 'try await ...' so the rejection is what is caught`,
          expression.span,
        ));
      }
      return optionalOf(attempted);
  }

  inferConditional(expression: Extract<Expression, { kind: "ConditionalExpression" }>, contextualType: ValueType): ValueType {
      {
        const condition = this.host.inferExpression(expression.condition);
        this.host.requireCondition(condition, expression.condition);
        const baseline = this.host.snapshotFlowFacts();
        let thenType = unknownType;
        const thenInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
          thenType = this.host.inferNarrowedExpression(
            expression.thenValue,
            this.host.narrowingFor(expression.condition, condition),
            contextualType,
          );
        });
        let elseType = unknownType;
        const elseInvalidations = this.host.analyzeIsolatedFlow(baseline, () => {
          elseType = this.host.inferNarrowedExpression(
            expression.elseValue,
            this.host.negativeNarrowingFor(expression.condition, condition),
            contextualType,
          );
        });
        this.host.applyFlowInvalidations([thenInvalidations, elseInvalidations], false);
        if (this.host.contextualObjectType(contextualType)
          && this.host.contextuallyAssignable(thenType, contextualType, expression.thenValue.span)
          && this.host.contextuallyAssignable(elseType, contextualType, expression.elseValue.span)) {
          this.host.contextualAssignments.set(spanIdentity(expression.span), contextualType);
        }
        return mergeTypes(thenType, elseType);
      }
  }

  inferIs(expression: Extract<Expression, { kind: "IsExpression" }>, contextualType: ValueType): ValueType {
      const subject = this.host.inferExpression(expression.value);
      this.host.allowBareGenericClassName(expression.type);
      const checked = this.host.resolveAnnotation(expression.type);
      const valid = this.host.validateTypeReference(expression.type);
      if (valid && this.host.rejectErasedRuntimeCheck(checked, expression.type.span)) return invalidType;
      if (valid && checked.kind === "class") {
        this.host.lowering.classChecks.add(spanIdentity(expression.span));
      }
      if (valid) {
        // GRM-D1 second half: bool is a closed primitive, so an `is` whose
        // subject is statically bool is decided at compile time — the same
        // constant-test reasoning as D42 item 64.
        const expandedSubject = this.host.expandAliases(subject);
        if (expandedSubject.kind === "bool") {
          const matches = this.host.expandAliases(checked).kind === "bool";
          const constant = (expression.operator === "is") === matches;
          this.host.typeError(
            `The subject is already statically bool, so '${expression.operator} ${describeType(checked)}' is always ${constant}; drop the constant test`,
            expression.span,
          );
        } else {
          this.host.rejectDisjointEnumTest(subject, checked, expression.operator, expression.span);
        }
      }
      return valid ? boolType : invalidType;
  }

  inferIndex(expression: Extract<Expression, { kind: "IndexExpression" }>, contextualType: ValueType): ValueType {
      const original = this.host.expandAliases(this.host.inferExpression(expression.object));
      const guarded = expression.optional && (original.kind === "optional" || original.kind === "null");
      if (!expression.optional && original.kind === "optional") {
        this.host.typeError(`Use optional index '?.[...]' for ${describeType(original)}`, expression.span);
      }
      if (original.kind === "null" && expression.optional) {
        const baseline = this.host.snapshotFlowFacts();
        this.host.analyzeIsolatedFlow(baseline, () => {
          this.host.inferExpression(expression.index);
        });
        this.host.lowering.optionalIndexes.add(spanIdentity(expression.span));
        return optionalOf(unknownType);
      }
      const object = guarded && original.kind === "optional" ? original.inner : original;
      const index = guarded
        ? this.host.withTemporaryNarrowings(
          this.host.optionalExecutionNarrowings(expression.object),
          expression.index.span,
          () => this.host.inferExpression(expression.index),
        )
        : this.host.inferExpression(expression.index);
      if (isInvalidType(object)) return invalidType;
      const binaryKind = binaryStorageKind(object);
      if (binaryKind) {
        this.host.requireAssignable(index, numberType, expression.index.span);
        this.host.lowering.binaryIndexes.set(spanIdentity(expression.span), binaryKind);
        if (guarded) {
          this.host.lowering.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(numberType);
        }
        return numberType;
      }
      if (object.kind === "list") {
        this.host.requireAssignable(index, numberType, expression.index.span);
        this.host.lowering.collectionIndexes.set(spanIdentity(expression.span), "list");
        const element = object.readonlyView ? this.host.readonlyDataViewOf(object.element) : object.element;
        if (guarded) {
          this.host.lowering.optionalIndexes.add(spanIdentity(expression.span));
          return optionalOf(element);
        }
        return element;
      }
      if (object.kind === "map") {
        this.host.typeError("Use Map.get(key) instead of bracket access", expression.span);
        // The rejected bracket form has no trustworthy result type. Giving
        // it the Map value type made `owners[key] ?? fallback` claim the
        // fallback was unnecessary, contradicting the very `.get()` rewrite
        // whose result is optional.
        return invalidType;
      }
      if (object.kind === "record") {
        this.host.requireAssignable(index, stringType, expression.index.span);
        this.host.lowering.collectionIndexes.set(spanIdentity(expression.span), "record");
        if (guarded) this.host.lowering.optionalIndexes.add(spanIdentity(expression.span));
        return optionalOf(object.readonlyView ? this.host.readonlyDataViewOf(object.value) : object.value);
      }
      if (object.kind === "string") {
        this.host.typeError("Use '.char(index)'; strings are not indexable and string positions count Unicode code points", expression.span);
        return unknownType;
      }
      if (object.kind !== "any") {
        // D90 R17: an unknown is a boundary value, so the refusal teaches
        // the validation ritual instead of restating the kind.
        this.host.typeError(`Cannot index ${describeType(object)}${object.kind === "unknown" && !isInvalidType(object) ? this.host.boundaryValidationGuidance(expression.object, null) : ""}`, expression.span);
      }
      return object.kind === "any" ? anyType : unknownType;
  }
}
