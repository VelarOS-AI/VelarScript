/** A positional call's shape must be valid before its slots supply contracts. */
import { type Expression } from "../../ast.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { invalidType, type ValueType } from "../../types.ts";
import { argumentNoun } from "./named-arguments.ts";

interface ArityHost {
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

/** Named calls and spreads have their own planners; this owns the fixed positions. */
export function refusePositionalArity(
  host: ArityHost,
  arguments_: readonly Expression[],
  argumentNames: readonly (string | null)[] | undefined,
  callSpan: Span,
  contract: { readonly parameters: readonly ValueType[]; readonly requiredParameters: number; readonly rest?: ValueType },
): boolean {
  if (argumentNames?.some((name) => name !== null) || arguments_.some((argument) => argument.kind === "SpreadExpression")) return false;
  const maximum = contract.rest ? Number.POSITIVE_INFINITY : contract.parameters.length;
  if (arguments_.length >= contract.requiredParameters && arguments_.length <= maximum) return false;
  const expected = contract.rest ? `at least ${contract.requiredParameters}`
    : contract.requiredParameters === maximum ? String(maximum) : `${contract.requiredParameters}-${maximum}`;
  host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
  // Slots shifted by an arity mistake cannot contextualize values. Still visit
  // them once, so a separate unknown name or explicitly typed bad body survives.
  for (const argument of arguments_) host.inferExpression(argument, invalidType);
  return true;
}
