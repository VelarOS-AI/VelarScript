import type { Program } from "./ast.ts";
import type { Span } from "./source.ts";

/**
 * D90 R19 / the audit's fourth root cause: a `let` binding is not categorically
 * unstable — it is unstable exactly when something reassigns it. This predicate
 * answers the decidable half of that question for one module: "has this
 * binding, declared where `declarationSpan` says, ever been reassigned or
 * re-declared under the same name anywhere in the program?" A `true` answer
 * licenses an analysis to treat the binding like a `const` alias; a `false`
 * answer only means the analysis must contribute nothing and leave the value
 * to its runtime referee, so `false` is always safe.
 *
 * The predicate is conservative by construction: any assignment targeting the
 * name, any other construct that could bind the name — a second declaration, a
 * parameter, a `using`, a catch name, an import, a match capture, a
 * destructuring entry, an embedded-JavaScript binding — and any occurrence of
 * the name in a position this walk cannot classify (extension statements carry
 * node kinds Core has never seen) all answer NO. The cost of that bluntness is
 * a missed static check, never a wrong one.
 */
export function bindingNeverReassigned(program: Program, name: string, declarationSpan: Span): boolean {
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "AssignmentStatement" || kind === "AssignmentExpression") {
      const target = node.target as Record<string, unknown> | undefined;
      if (target && target.kind === "IdentifierExpression" && target.name === name) return false;
    }
    if (bindsName(node, kind, name) && !isSpan(node.span, declarationSpan)) return false;
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return true;
}

/**
 * Node kinds whose `name` property is a read or a label, never a value
 * binding: an identifier read, a type reference, and an object literal's field
 * key. Every kind outside this set — and every kind-less record like a
 * `Parameter` or an embedded-JavaScript capture — is treated as a possible
 * binding of the name, which errs exactly toward NO.
 */
const nameIsReferenceKinds = new Set(["IdentifierExpression", "NamedTypeSyntax", "GenericTypeSyntax", "ObjectProperty"]);

function bindsName(node: Record<string, unknown>, kind: string | null, name: string): boolean {
  if (node.name === name && (kind === null || !nameIsReferenceKinds.has(kind))) return true;
  // TryStatement's catch binding and an import specifier's local name bind
  // without a `name` property.
  return node.catchName === name || node.local === name;
}

function isSpan(value: unknown, span: Span): boolean {
  return typeof value === "object" && value !== null
    && (value as Span).start === span.start && (value as Span).end === span.end;
}
