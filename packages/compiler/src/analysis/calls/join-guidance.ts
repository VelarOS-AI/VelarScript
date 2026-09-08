/** The path/url calling-convention remedy, owned by the resolved import. */
import { type Expression } from "../../ast.ts";
import { recoveredDiagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { stringType, type ValueType } from "../../types.ts";

export interface JoinGuidanceHost {
  readonly diagnostics: Diagnostic[];
  readonly sourceText: string;
  importedMemberOf(name: string): { readonly source: string; readonly imported: string | null } | null;
  inferExpression(expression: Expression): ValueType;
  commentPreservingMechanicalFix(rewriteSpan: Span, replacement: string, title: string): DiagnosticFix | undefined;
}

/**
 * A positional path join or a List-literal URL join has one unambiguous
 * remedy. Resolve the binding's original export, not its local spelling: a
 * renamed join keeps its contract, while another export called join does not
 * acquire one. Values with merely incompatible types keep ordinary checking.
 */
export function inferCrossConventionJoinCall(
  host: JoinGuidanceHost,
  callee: Expression,
  arguments_: readonly Expression[],
  argumentNames: readonly (string | null)[] | undefined,
  callSpan: Span,
): ValueType | null {
  if (callee.kind !== "IdentifierExpression") return null;
  const imported = host.importedMemberOf(callee.name);
  if (imported?.imported !== "join") return null;
  if (argumentNames?.some((name) => name !== null)) return null;
  if (arguments_.some((argument) => argument.kind === "SpreadExpression")) return null;
  const list = arguments_.length === 1 && arguments_[0]!.kind === "ListExpression" ? arguments_[0]! : null;
  const written = (expression: Expression): string => host.sourceText.slice(expression.span.start, expression.span.end);
  let replacement: string;
  let message: string;
  if (imported.source === "velar/path" && arguments_.length > 1) {
    replacement = `${callee.name}([${arguments_.map(written).join(", ")}])`;
    message = `'velar/path' joins one List of segments — write '${replacement}'; the positional 'join(a, b, ...)' is the convention of 'velar/url', and the two modules keep different ones`;
  } else if (imported.source === "velar/url" && list?.elements.length) {
    replacement = `${callee.name}(${list.elements.map(written).join(", ")})`;
    message = `'velar/url' joins segments positionally — write '${replacement}'; the one-List 'join([...])' is the convention of 'velar/path', and the two modules keep different ones`;
  } else return null;
  for (const argument of arguments_) host.inferExpression(argument);
  host.diagnostics.push(recoveredDiagnostic("VEL3008", message, callSpan,
    host.commentPreservingMechanicalFix(callSpan, replacement, "Use this module's join convention")));
  return stringType;
}
