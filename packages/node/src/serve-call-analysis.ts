import {
  Analyzer,
  spanIdentity,
  unknownType,
  type Expression,
  type Program,
  type ValueType,
} from "@velarscript/compiler/extension";

/**
 * The seam every `velar/serve` call-site rule in this package shares, and the
 * first of those rules.
 *
 * Core resolves a call's callee and a member access's receiver from inside its
 * own analysis, which reaches this override, so every type this module infers
 * is recorded by span here and the rules above read it afterwards. That keeps
 * analysis single-run: a rule costs no second inference and cannot reorder
 * Core's own bookkeeping.
 *
 * ── The static root a build can already see ────────────────────────────────
 *
 * D114 F9-node-cli, audit NO-U2: `file("/x", root="../shared")` compiled, and
 * `velar check` passed, and the program then served files the project does not
 * contain. Every other part of this toolchain refuses source that leaves the
 * project; a directory that leaves it was the one thing nobody looked at. The
 * runtime refuses it now — `velar/serve` judges the root where it turns it into
 * a path, so `staticFiles` refuses while the application is still being
 * assembled and `file`/`fileResponse` refuse the first time a route reaches
 * them — but a literal root is knowable long before that, and a build that can
 * see a defect must not wait for a request to prove it.
 *
 * Only a literal is judged. A root that is computed resolves to nothing here
 * and is left to the runtime, for the reason the route-conflict referee gives
 * for the same choice: a false refusal blocks a correct program.
 */
export class VelarNodeServeCallAnalyzer extends Analyzer {
  /**
   * Every type this module infers, by span. The receiver or callee's entry is
   * present by the time the expression that owns it returns, so reading it
   * afterwards is always answering about something already inferred.
   */
  protected readonly inferredTypesBySpan = new Map<string, ValueType>();

  override analyze(program: Program) {
    this.inferredTypesBySpan.clear();
    return super.analyze(program);
  }

  protected override inferExpression(expression: Expression, contextualType: ValueType = unknownType): ValueType {
    const result = super.inferExpression(expression, contextualType);
    this.inferredTypesBySpan.set(spanIdentity(expression.span), result);
    if (expression.kind === "CallExpression") this.checkServeStaticRoot(expression);
    return result;
  }

  /**
   * The `root` argument of the three `velar/serve` functions that name a
   * directory, when the author wrote it as a literal.
   *
   * A call is one of those three when the name is one of theirs *and* the
   * callee's inferred type is the declaration this package publishes for it,
   * matched by its parameter names: an author's own `file(path, root)` is a
   * different function and is not judged by this rule.
   */
  private checkServeStaticRoot(expression: Expression & { readonly kind: "CallExpression" }): void {
    const callee = expression.callee;
    if (callee.kind !== "IdentifierExpression") return;
    const position = SERVE_ROOT_PARAMETERS.get(callee.name);
    if (position === undefined) return;
    const declared = this.inferredTypesBySpan.get(spanIdentity(callee.span));
    if (!declared || declared.kind !== "function") return;
    const names = declared.parameterNames;
    if (!names || names.length !== position.names.length || names.some((name, index) => name !== position.names[index])) return;
    const root = serveArgument(expression, position.names[position.root]!, position.root);
    if (!root || root.kind !== "LiteralExpression" || typeof root.value !== "string") return;
    if (!escapesProject(root.value)) return;
    this.typeError(
      `A relative static root names a directory inside the project; '${root.value}' leaves it. Name a directory inside the project, or pass an absolute root for one outside it`,
      root.span,
    );
  }
}

/** The parameter tuple each of the three publishes, and where `root` sits in it. */
const SERVE_ROOT_PARAMETERS: ReadonlyMap<string, { readonly names: readonly string[]; readonly root: number }> = new Map([
  ["file", { names: ["path", "root", "fallback"], root: 1 }],
  ["staticFiles", { names: ["path", "root", "fallback"], root: 1 }],
  ["fileResponse", { names: ["root", "path", "fallback"], root: 0 }],
]);

/** The argument written for one parameter, whether it was passed by name or by position. */
function serveArgument(
  expression: Expression & { readonly kind: "CallExpression" },
  name: string,
  position: number,
): Expression | null {
  const names = expression.argumentNames;
  if (names) {
    const named = names.indexOf(name);
    if (named >= 0) return expression.arguments[named] ?? null;
    if (names[position] != null && names[position] !== name) return null;
  }
  return expression.arguments[position] ?? null;
}

/** Whether a relative root climbs out of the directory it is resolved against. */
function escapesProject(root: string): boolean {
  return root.split(/[/\\]/u).includes("..");
}
