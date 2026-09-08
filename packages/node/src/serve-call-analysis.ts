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
 * Literals and Core's proved immutable scalar expressions are judged. A root
 * that requires runtime evaluation remains with the runtime, for the reason the route-conflict referee gives
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
   * directory, when Core can prove its scalar value.
   *
   * Its resolved import identity, including immutable aliases, selects the
   * contract. Core's existing named-argument plan selects the root slot.
   */
  private checkServeStaticRoot(expression: Expression & { readonly kind: "CallExpression" }): void {
    const callee = expression.callee;
    if (callee.kind !== "IdentifierExpression") return;
    const origin = this.importedMemberOf(callee.name);
    if (origin?.source !== "velar/serve" || origin.imported === null) return;
    const position = SERVE_ROOT_PARAMETERS.get(origin.imported);
    if (position === undefined) return;
    const declared = this.inferredTypesBySpan.get(spanIdentity(callee.span));
    if (!declared || declared.kind !== "function") return;
    const names = declared.parameterNames;
    if (!names || names.length !== position.names.length || names.some((name, index) => name !== position.names[index])) return;
    const root = this.resolvedCallArgument(expression, position.root);
    if (!root) return;
    const value = this.constantValue(root);
    if (typeof value !== "string" || !escapesProject(value)) return;
    this.typeError(
      `${callee.name} root '${value}' leaves the project directory that holds velar.json: a relative root names a directory inside it, and a directory outside it is named by an absolute path`,
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

/**
 * Whether a relative root climbs out of the directory it is resolved against,
 * judged the way `velar/serve` judges it at runtime: on the normalized root.
 *
 * D114 F10-node, audit NO-I6: a `..` anywhere in the text was an escape, so
 * `public/../public` — the project's own `public/` written the long way round —
 * was refused with a sentence saying it left the project, which it does not. A
 * segment is only an escape when nothing is left for it to climb out of.
 */
function escapesProject(root: string): boolean {
  if (root.startsWith("/") || root.startsWith("\\") || /^[A-Za-z]:[/\\]/u.test(root)) return false;
  let depth = 0;
  for (const segment of root.split(/[/\\]/u)) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") { depth += 1; continue; }
    if (depth === 0) return true;
    depth -= 1;
  }
  return false;
}
