import { mechanicalFix } from "@velarscript/compiler";
import {
  Analyzer,
  nonOptional,
  spanIdentity,
  unknownType,
  type Expression,
  type Program,
  type Span,
  type ValueType,
} from "@velarscript/compiler/extension";
import { VELAR_HTTP_PROBLEM_IDENTITY } from "./server-types.ts";

/**
 * D114 P6 item 12 (audit SV-D2 / SV-C1): `.code` on an `HttpProblem` is the
 * retired spelling of `.reason`.
 *
 * Through 0.29 `HttpProblem` declared the semantic problem code as a field
 * named `code`, and charter section 11 owns that name on every checked `Error`
 * as the instance's class name and forbids a subclass from redeclaring it. So
 * the declaration said `route.not_found` and every read answered the constant
 * `"HttpProblem"` — including the read the official skill and the repository
 * tour both taught, `outcome.problem.code`, which shipped that constant to
 * clients with no diagnostic anywhere.
 *
 * The field is `reason` now. Renaming it alone would leave the same source
 * compiling with a silently different meaning, which is exactly what a retired
 * spelling exists to stop, so the read is refused and names one successor.
 * This is Core's retired collection member shape
 * (`compiler/src/analysis/members.ts`): one rejection naming one successor,
 * carrying the rename of the member name itself so `velar fix` applies it.
 */
const RETIRED_PROBLEM_MEMBER = "code";
const PROBLEM_REASON_MEMBER = "reason";

/**
 * The half of the Node analyzer that owns the `HttpProblem` member contract.
 * It is a base class rather than a helper because the rule needs the analyzer's
 * own `inferExpression` seam: the receiver's type is read from the types this
 * analyzer has already inferred, so the rule costs no second inference and
 * cannot reorder Core's member bookkeeping.
 */
export class VelarNodeProblemAnalyzer extends Analyzer {
  /**
   * Every type this module infers, by span. Core resolves a member access's
   * receiver from inside its own member analysis, which reaches this override,
   * so the receiver's entry is present by the time the member expression itself
   * returns and reading it afterwards keeps analysis single-run.
   */
  private readonly inferredTypesBySpan = new Map<string, ValueType>();

  override analyze(program: Program) {
    this.inferredTypesBySpan.clear();
    return super.analyze(program);
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const result = super.inferExpression(expression, contextualType);
    this.inferredTypesBySpan.set(spanIdentity(expression.span), result);
    if (expression.kind === "MemberExpression" && expression.property === RETIRED_PROBLEM_MEMBER) {
      const receiver = this.inferredTypesBySpan.get(spanIdentity(expression.object.span));
      if (receiver && this.isHttpProblem(receiver)) this.reportRetiredProblemMember(expression.span);
    }
    return result;
  }

  private isHttpProblem(type: ValueType): boolean {
    const resolved = nonOptional(this.expandAliases(type));
    return resolved.kind === "class" && resolved.identity === VELAR_HTTP_PROBLEM_IDENTITY;
  }

  private reportRetiredProblemMember(memberSpan: Span): void {
    const fix = memberSpan.end - memberSpan.start >= RETIRED_PROBLEM_MEMBER.length
      ? mechanicalFix(
        {start: memberSpan.end - RETIRED_PROBLEM_MEMBER.length, end: memberSpan.end},
        PROBLEM_REASON_MEMBER,
        `Use '${PROBLEM_REASON_MEMBER}'`,
      )
      : undefined;
    this.typeError(
      `'HttpProblem' reads its semantic problem code as '${PROBLEM_REASON_MEMBER}'; '${RETIRED_PROBLEM_MEMBER}' is the Error contract's own member and is always the class name 'HttpProblem'. The wire problem document still publishes '${PROBLEM_REASON_MEMBER}' under its JSON name "${RETIRED_PROBLEM_MEMBER}"`,
      memberSpan,
      fix,
    );
  }
}
