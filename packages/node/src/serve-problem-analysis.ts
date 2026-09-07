import { mechanicalFix } from "@velarscript/compiler";
import {
  astNodesOfKind,
  nonOptional,
  spanIdentity,
  unknownType,
  type Expression,
  type Program,
  type Span,
  type Statement,
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

/** The two record shapes this rule reads: an argument literal and a `const`'s. */
type ObjectExpression = Extract<Expression, { readonly kind: "ObjectExpression" }>;
type VariableDeclaration = Extract<Statement, { readonly kind: "VariableDeclaration" }>;

/**
 * One `HttpProblem(<record>)`: where the call is, where Core's own report about
 * the argument lands, and where the retired key is — `null` when this module is
 * looking at a record whose literal it cannot see.
 */
interface RetiredProblemOption {
  readonly callee: Expression;
  readonly argument: Expression;
  readonly options: Span;
  readonly retired: Span | null;
}

/** Core's own report about the whole argument, which this rule replaces. */
const CANNOT_ASSIGN_ARGUMENT = "Cannot assign ";

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

  /**
   * D114 F10-node, audit NO-I2: every record literal this module binds to a
   * name, so a construction written as `HttpProblem(record)` can be answered at
   * the `code:` the author actually wrote rather than at the variable that
   * carries it. A name declared more than once is dropped: two literals are two
   * possible carets, and a rule that guesses between them would put the caret
   * on a key the call may never reach.
   */
  private problemRecordLiterals: ReadonlyMap<string, ObjectExpression> = new Map();

  override analyze(program: Program) {
    this.rewrittenProblemOptions.clear();
    this.problemRecordLiterals = boundRecordLiterals(program);
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
    const argument = expression.arguments[0];
    if (!argument) return null;
    if (argument.kind === "ObjectExpression") {
      const retired = retiredProblemKey(argument);
      return retired === null ? null : { callee: expression.callee, argument, options: argument.span, retired };
    }
    // NO-I2: the record reached the call through a name. The literal is the
    // site worth pointing at when this module can see it; when it cannot — an
    // imported record, a value a function returned — the report is the sentence
    // alone, which is still the one thing the author needs to read.
    const declared = argument.kind === "IdentifierExpression" ? this.problemRecordLiterals.get(argument.name) : undefined;
    return { callee: expression.callee, argument, options: argument.span, retired: declared ? retiredProblemKey(declared) : null };
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
    // A record that reached the call through a name is confirmed by its own
    // inferred type, not by the literal this module happened to find under that
    // name: a shadowed binding, or a name this rule guessed at, must not turn
    // an unrelated assignment failure into the rename's report.
    if (constructed.argument.kind !== "ObjectExpression" && !this.writesRetiredProblemCode(constructed.argument)) return;
    const site = constructed.retired ?? constructed.options;
    const identity = spanIdentity(site);
    const options = spanIdentity(constructed.options);
    // Core's own reports about this one mistake are dropped on every visit —
    // it may infer one expression more than once — and the one report is
    // written on the first.
    for (let index = this.diagnostics.length - 1; index >= before; index -= 1) {
      const reported = this.diagnostics[index]!;
      const where = spanIdentity(reported.span);
      if (where !== options && where !== identity) continue;
      if (reported.message !== MISSING_REASON_FIELD && reported.message !== UNKNOWN_CODE_FIELD
        && !reported.message.startsWith(CANNOT_ASSIGN_ARGUMENT)) continue;
      this.diagnostics.splice(index, 1);
    }
    if (this.rewrittenProblemOptions.has(identity)) return;
    this.rewrittenProblemOptions.add(identity);
    this.typeError(
      constructed.retired === null
        ? `'HttpProblem' takes its semantic problem code as '${PROBLEM_REASON_MEMBER}'; this record writes the retired '${RETIRED_PROBLEM_MEMBER}', which is the Error contract's own member and cannot be given a value. The wire problem document still publishes '${PROBLEM_REASON_MEMBER}' under its JSON name "${RETIRED_PROBLEM_MEMBER}"`
        : `'HttpProblem' takes its semantic problem code as '${PROBLEM_REASON_MEMBER}'; '${RETIRED_PROBLEM_MEMBER}' is the Error contract's own member and cannot be given a value. The wire problem document still publishes '${PROBLEM_REASON_MEMBER}' under its JSON name "${RETIRED_PROBLEM_MEMBER}"`,
      site,
      constructed.retired === null
        ? undefined
        : mechanicalFix(
          { start: constructed.retired.start, end: constructed.retired.start + RETIRED_PROBLEM_MEMBER.length },
          PROBLEM_REASON_MEMBER,
          `Use '${PROBLEM_REASON_MEMBER}'`,
        ),
    );
  }

  /** Whether the value handed to the constructor really writes `code` and no `reason`. */
  private writesRetiredProblemCode(argument: Expression): boolean {
    const type = this.inferredTypesBySpan.get(spanIdentity(argument.span));
    if (!type) return false;
    const resolved = nonOptional(this.expandAliases(type));
    const fields = resolved.kind === "object" ? resolved.fields
      : resolved.kind === "named" && resolved.identity ? this.fieldsOf(resolved.identity)
        : null;
    if (!fields) return false;
    return fields.has(RETIRED_PROBLEM_MEMBER) && !fields.has(PROBLEM_REASON_MEMBER);
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

/** The `code:` key one record literal writes, when it writes one and no `reason`. */
function retiredProblemKey(options: ObjectExpression): Span | null {
  let retired: Span | null = null;
  for (const entry of options.properties) {
    if (entry.kind !== "ObjectProperty") return null;
    if (entry.name === PROBLEM_REASON_MEMBER) return null;
    if (entry.name === RETIRED_PROBLEM_MEMBER) retired = entry.span;
  }
  return retired;
}

/** Every name this module binds to a record literal exactly once, anywhere in it. */
function boundRecordLiterals(program: Program): ReadonlyMap<string, ObjectExpression> {
  const literals = new Map<string, ObjectExpression>();
  const rebound = new Set<string>();
  for (const statement of astNodesOfKind<VariableDeclaration>(program, "VariableDeclaration")) {
    if (statement.pattern.kind !== "NameBindingPattern") continue;
    const name = statement.pattern.name;
    if (rebound.has(name) || literals.has(name)) {
      literals.delete(name);
      rebound.add(name);
      continue;
    }
    if (statement.initializer.kind !== "ObjectExpression") continue;
    literals.set(name, statement.initializer);
  }
  return literals;
}
