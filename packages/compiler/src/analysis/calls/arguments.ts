/**
 * The argument list of one call: how many values a callable accepts, what each
 * position expects, and what a call spread or a named argument is allowed to
 * stand for.
 *
 * D114 R1f: every caller of this check is in this directory — an ordinary call,
 * an intrinsic and a collection member all check their arguments the same way —
 * so it moves out of `analyzer.ts` to sit beside them. `named-arguments.ts`
 * still owns the *plan* (which source position fills which parameter slot);
 * this module owns what the plan is then checked against.
 */
import { type Expression } from "../../ast.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { describeType, unknownType, type ValueType } from "../../types.ts";
import { argumentNoun, type NamedArgumentPlan } from "./named-arguments.ts";
import { type MutableCellTarget } from "../scopes.ts";

/** What the argument check asks of the analyzer that hosts it, and nothing more. */
export interface CallArgumentsHost {
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): NamedArgumentPlan | null;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell?: MutableCellTarget | null): void;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class CallArguments {
  private readonly host: CallArgumentsHost;

  constructor(host: CallArgumentsHost) {
    this.host = host;
  }

  checkArguments(
    arguments_: readonly Expression[],
    parameters: readonly ValueType[],
    callSpan: Span,
    requiredParameters = parameters.length,
    rest?: ValueType,
    argumentNames?: readonly (string | null)[],
    parameterNames?: readonly string[],
  ): void {
    if (argumentNames?.some((name) => name !== null)) {
      this.orderNamedArguments(arguments_, argumentNames, parameters, parameterNames, requiredParameters, callSpan, rest);
      return;
    }
    const firstSpread = arguments_.findIndex((argument) => argument.kind === "SpreadExpression");
    if (firstSpread >= 0) {
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          const type = this.host.iterationSource(argument.value, this.host.inferExpression(argument.value));
          if (!rest) this.host.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < parameters.length) {
            this.host.typeError(`Provide all ${parameters.length} fixed argument${parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          } else if (type.kind === "list") this.host.requireAssignable(type.element, rest, argument.span);
          if (type.kind !== "list" && type.kind !== "any") {
            this.host.typeError(`Call spread requires a List, received ${describeType(type)}${this.host.iterationGuidance(type)}`, argument.span);
          }
          fixedIndex = parameters.length;
          continue;
        }

        const expected = sawSpread ? rest : parameters[fixedIndex] ?? rest;
        const actual = this.host.inferExpression(argument, expected ?? unknownType);
        if (expected) this.host.requireAssignable(actual, expected, argument.span);
        else this.host.typeError("This fixed-arity call has no position for another argument", argument.span);
        if (!sawSpread && fixedIndex < parameters.length) fixedIndex += 1;
      }
      return;
    }

    if (arguments_.length < requiredParameters || (!rest && arguments_.length > parameters.length)) {
      const expected = rest
        ? `at least ${requiredParameters}`
        : requiredParameters === parameters.length ? String(parameters.length) : `${requiredParameters}-${parameters.length}`;
      this.host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
    }
    for (let index = 0; index < arguments_.length; index += 1) {
      const expected = parameters[index] ?? rest ?? unknownType;
      const actual = this.host.inferExpression(arguments_[index]!, expected);
      this.host.requireAssignable(actual, expected, arguments_[index]!.span);
    }
  }

  orderNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): readonly Expression[] | null {
    const plan = this.host.planNamedArguments(
      arguments_,
      argumentNames,
      parameters,
      parameterNames,
      requiredParameters,
      callSpan,
      rest,
    );
    if (!plan) return null;
    for (const [source, target] of plan.targets.entries()) {
      const argument = arguments_[source]!;
      const value = argument.kind === "SpreadExpression" ? argument.value : argument;
      const expected = target === null ? unknownType : parameters[target] ?? rest ?? unknownType;
      const actual = this.host.inferExpression(value, expected);
      if (target !== null) this.host.requireAssignable(actual, expected, argument.span);
    }
    return plan.valid ? plan.ordered : null;
  }
}
