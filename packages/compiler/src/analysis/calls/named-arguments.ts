/**
 * The named-argument plan: how `f(b=2, a=1)` becomes positions, and the two
 * words every arity report is written with.
 *
 * D115 §三: this was one method and two helpers of `CallInference`. Every other
 * file of this directory reaches it — an ordinary call, a generic call, an
 * intrinsic and a collection member all plan their named arguments the same way
 * — so it is the leaf of the directory, and the one instance the facade builds
 * is handed to the two files that need it rather than rebuilt in each.
 */
import { type Expression } from "../../ast.ts";
import { mechanicalFix, type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import { type ValueType } from "../../types.ts";
import { uniqueNearestName } from "../nearest-names.ts";

export function argumentNoun(expected: string): "argument" | "arguments" {
  return expected === "1" || expected === "at least 1" ? "argument" : "arguments";
}

export function trimTrailingOmittedArguments(sources: readonly number[]): readonly number[] {
  let length = sources.length;
  while (length > 0 && sources[length - 1] === -1) length -= 1;
  return sources.slice(0, length);
}

/** Consume the planner's parameter positions without reinterpreting source labels. */
export function orderedArgumentValues(arguments_: readonly Expression[], sources: readonly number[] | undefined, callSpan: Span): readonly Expression[] {
  return sources?.map((source) => source === -1
    ? { kind: "IdentifierExpression", name: "\u0000omitted-named-argument", span: callSpan } satisfies Expression
    : arguments_[source]!) ?? arguments_;
}

export interface NamedArgumentPlan {
  readonly ordered: readonly Expression[];
  readonly targets: readonly (number | null)[];
  readonly valid: boolean;
}

/**
 * The one lowering table a plan writes: the source position each parameter
 * slot was filled from, so the emitter can rebuild the positional call.
 */
interface NamedArgumentLoweringFacts {
  readonly namedArgumentOrders: Map<string, readonly number[]>;
}

/** What the planner asks of the analyzer that hosts it, and nothing more. */
export interface NamedArgumentsHost {
  readonly lowering: NamedArgumentLoweringFacts;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class NamedArguments {
  private readonly host: NamedArgumentsHost;
  private readonly labelSpans = new Map<string, readonly (Span | null)[]>();

  constructor(host: NamedArgumentsHost) {
    this.host = host;
  }

  /** Parser-owned token spans survive comments, multiline values and nesting. */
  registerCall(expression: Extract<Expression, { kind: "CallExpression" }>): void {
    if (expression.argumentNameSpans) this.labelSpans.set(spanIdentity(expression.span), expression.argumentNameSpans);
  }

  planNamedArguments(
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    parameters: readonly ValueType[],
    parameterNames: readonly string[] | undefined,
    requiredParameters: number,
    callSpan: Span,
    rest?: ValueType,
  ): NamedArgumentPlan | null {
    if (!argumentNames?.some((name) => name !== null)) return null;
    if (!parameterNames || parameterNames.length !== parameters.length || parameterNames.some((name) => !name)) {
      this.host.typeError("This callable does not expose stable parameter names", callSpan);
      return {
        ordered: arguments_,
        targets: arguments_.map(() => null),
        valid: false,
      };
    }

    const sources = Array<number>(parameters.length).fill(-1);
    const targets: (number | null)[] = [];
    const unknown: { readonly name: string; readonly span: Span }[] = [];
    let nextPositional = 0;
    let valid = !arguments_.some((argument) => argument.kind === "SpreadExpression");
    if (!valid) this.host.typeError("Named arguments cannot be combined with a call spread", callSpan);
    for (const [source, argument] of arguments_.entries()) {
      const name = argumentNames[source] ?? null;
      let target: number;
      if (name === null) {
        while (nextPositional < sources.length && sources[nextPositional] !== -1) nextPositional += 1;
        target = nextPositional++;
      } else {
        target = parameterNames.indexOf(name);
        if (target === -1) {
          unknown.push({ name, span: this.labelSpans.get(spanIdentity(callSpan))?.[source] ?? argument.span });
          targets.push(null);
          valid = false;
          continue;
        }
      }
      if (target >= sources.length) {
        this.host.typeError(rest
          ? "Named calls cannot pass values to a rest parameter"
          : "This fixed-arity call has no position for another argument", argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      if (sources[target] !== -1) {
        this.host.typeError(`Parameter '${parameterNames[target]}' is provided more than once`, argument.span);
        targets.push(null);
        valid = false;
        continue;
      }
      sources[target] = source;
      targets.push(target);
    }
    const missing = parameterNames.filter((_, index) => index < requiredParameters && sources[index] === -1);
    const remedies = new Set<string>();
    let missingExplained = false;
    for (const item of unknown) {
      const nearest = uniqueNearestName(item.name, parameterNames);
      const target = nearest === null ? -1 : parameterNames.indexOf(nearest);
      const safe = nearest !== null && sources[target] === -1 && !remedies.has(nearest);
      if (safe) remedies.add(nearest);
      const missingHint = unknown.length === 1 && !safe && missing.length > 0
        ? `; missing required named argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}` : "";
      if (missingHint) missingExplained = true;
      this.host.typeError(`Unknown named argument '${item.name}'${safe ? `; did you mean '${nearest}'?` : missingHint}`, item.span,
        safe && this.labelSpans.has(spanIdentity(callSpan)) ? mechanicalFix(item.span, nearest, `Use '${nearest}'`) : undefined);
    }
    const remaining = missing.filter((name) => !remedies.has(name));
    if (remaining.length > 0 && !missingExplained) {
      this.host.typeError(`Missing required named argument${remaining.length === 1 ? "" : "s"}: ${remaining.join(", ")}`, callSpan);
      valid = false;
    }
    this.host.lowering.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(sources));
    return {
      ordered: orderedArgumentValues(arguments_, sources, callSpan),
      targets,
      valid,
    };
  }
}
