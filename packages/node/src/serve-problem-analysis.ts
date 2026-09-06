import { mechanicalFix } from "@velarscript/compiler";
import {
  nonOptional,
  spanIdentity,
  unknownType,
  type Expression,
  type Program,
  type Span,
  type ValueType,
} from "@velarscript/compiler/extension";
import { VelarNodeServeCallAnalyzer } from "./serve-call-analysis.ts";
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
/** The two the object contract answers with, which this rule replaces with one. */
const MISSING_REASON_FIELD = `Object is missing required field '${PROBLEM_REASON_MEMBER}'`;
const UNKNOWN_CODE_FIELD = `Object has no field '${RETIRED_PROBLEM_MEMBER}'`;

/** One `HttpProblem({code: ...})`: where the call is, and where the retired key is. */
interface RetiredProblemOption {
  readonly callee: Expression;
  readonly options: Span;
  readonly retired: Span;
}

/**
 * The half of the Node analyzer that owns the `HttpProblem` rename — both sides
 * of it, the read and the construction.
 *
 * It is a class in the analyzer's chain rather than a helper because both rules
 * need the `inferExpression` seam its base holds open: the receiver's and the
 * callee's types are read from what this analyzer has already inferred, so
 * neither rule costs a second inference nor reorders Core's own bookkeeping.
 */
export class VelarNodeProblemAnalyzer extends VelarNodeServeCallAnalyzer {
  /**
   * The construction sites this rule has already answered for, so the object
   * literal's own two reports can be dropped exactly once and a second pass
   * over the same span cannot double the replacement.
   */
  private readonly rewrittenProblemOptions = new Set<string>();

  override analyze(program: Program) {
    this.rewrittenProblemOptions.clear();
    return super.analyze(program);
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const constructed = expression.kind === "CallExpression" ? this.retiredProblemOption(expression) : null;
    const before = constructed === null ? 0 : this.diagnostics.length;
    const result = super.inferExpression(expression, contextualType);
    if (expression.kind === "MemberExpression" && expression.property === RETIRED_PROBLEM_MEMBER) {
      const receiver = this.inferredTypesBySpan.get(spanIdentity(expression.object.span));
      if (receiver && this.isHttpProblem(receiver)) this.reportRetiredProblemMember(expression.span);
    }
    if (constructed !== null) this.reportRetiredProblemOption(constructed, before);
    return result;
  }

  /**
   * The `code:` an `HttpProblem` is still being constructed with — the one
   * construction site every 0.29 program has.
   *
   * The receiver's type is not available before Core has inferred the callee,
   * so the call is recognised by its shape first (a call whose sole argument is
   * an object literal that writes `code` and not `reason`) and confirmed by the
   * callee's type afterwards, once Core has recorded it.
   */
  private retiredProblemOption(expression: Expression & { readonly kind: "CallExpression" }): RetiredProblemOption | null {
    if (expression.arguments.length !== 1) return null;
    const options = expression.arguments[0];
    if (!options || options.kind !== "ObjectExpression") return null;
    let retired: Span | null = null;
    for (const entry of options.properties) {
      if (entry.kind !== "ObjectProperty") return null;
      if (entry.name === PROBLEM_REASON_MEMBER) return null;
      if (entry.name === RETIRED_PROBLEM_MEMBER) retired = entry.span;
    }
    return retired === null ? null : { callee: expression.callee, options: options.span, retired };
  }

  /**
   * D114 F9-node-cli, audit NO-I1: one report, naming the successor, carrying
   * the rewrite.
   *
   * The read side of this rename was the model — one rejection, `reason` named,
   * `velar fix` applying it — and the construction side was two generic reports
   * that never said the word `reason`: "Object is missing required field
   * 'reason'" on the whole literal and "Object has no field 'code'" on the
   * entry, and `velar fix` changed nothing. Those two are the object contract
   * answering a question the author did not ask; they are dropped for this
   * literal and replaced by the one sentence the rename owes, with the
   * mechanical rewrite of the key itself so `velar fix` finishes the migration
   * on both sides in one run.
   */
  private reportRetiredProblemOption(constructed: RetiredProblemOption, before: number): void {
    const callee = this.inferredTypesBySpan.get(spanIdentity(constructed.callee.span));
    if (!callee || callee.kind !== "classConstructor" || callee.identity !== VELAR_HTTP_PROBLEM_IDENTITY) return;
    const identity = spanIdentity(constructed.retired);
    const options = spanIdentity(constructed.options);
    // The two are dropped on every visit — Core may infer one expression more
    // than once — and the one report is written on the first.
    for (let index = this.diagnostics.length - 1; index >= before; index -= 1) {
      const reported = this.diagnostics[index]!;
      const where = spanIdentity(reported.span);
      if (where !== options && where !== identity) continue;
      if (reported.message !== MISSING_REASON_FIELD && reported.message !== UNKNOWN_CODE_FIELD) continue;
      this.diagnostics.splice(index, 1);
    }
    if (this.rewrittenProblemOptions.has(identity)) return;
    this.rewrittenProblemOptions.add(identity);
    this.typeError(
      `'HttpProblem' takes its semantic problem code as '${PROBLEM_REASON_MEMBER}'; '${RETIRED_PROBLEM_MEMBER}' is the Error contract's own member and cannot be given a value. The wire problem document still publishes '${PROBLEM_REASON_MEMBER}' under its JSON name "${RETIRED_PROBLEM_MEMBER}"`,
      constructed.retired,
      mechanicalFix(
        { start: constructed.retired.start, end: constructed.retired.start + RETIRED_PROBLEM_MEMBER.length },
        PROBLEM_REASON_MEMBER,
        `Use '${PROBLEM_REASON_MEMBER}'`,
      ),
    );
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
