/**
 * What a derived value refuses and what a derived read is: the call that should
 * have been a bare read, the assignment that has no location to land on, and the
 * reading that decides whether a name really resolves to a reactive derivation
 * here.
 *
 * D115 P4 R3c. The three sit above `bindings.ts` because each of them starts by
 * asking which declaration a name resolves to and then says what follows.
 */
import { isInvalidType, type Expression, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { diagnostic } from "../web-types.ts";
import { isComputedBinding, isImportedComputedBinding } from "./bindings.ts";
import { type ReactiveNamesHost } from "./host.ts";

/**
 * D71 rule 182: a declared derived value is read bare, exactly like state.
 * Calling one is the habit the retired `computed(...)` accessor taught, and it
 * is also what a half-migrated project looks like from the importing side — so
 * the answer names the one spelling and carries the edit that reaches it,
 * which is what lets `velar fix` finish a migration that crosses modules.
 */
export function calledComputedBinding(
  host: ReactiveNamesHost,
  expression: Extract<Expression, { readonly kind: "CallExpression" }>,
): ValueType | null {
  if (expression.callee.kind !== "IdentifierExpression") return null;
  const name = expression.callee.name;
  if (!isComputedBinding(host, name)) return null;
  const type = host.inferExpression(expression.callee);
  // A derived value that *is* a function is called on purpose; only a
  // non-callable one makes the parentheses a mistake.
  const expanded = host.expandAliases(type);
  if (expanded.kind === "function" || expanded.kind === "intrinsic" || expanded.kind === "any" || isInvalidType(expanded)) return null;
  host.diagnostics.push({
    code: "VEL5063",
    message: `'${name}' is a computed value, not a reader: it is read bare like state, so write '${name}' rather than '${name}()'`,
    span: expression.span,
    fix: {
      title: `Read '${name}' bare`,
      edits: [{ span: { start: expression.callee.span.end, end: expression.span.end }, text: "" }],
    },
  });
  return type;
}

/**
 * D71 rule 182: a derived value has no writable location behind it, so the
 * const message ("cannot assign to const binding") would name the wrong
 * reason. Answering here means the reader is told what a derived value is and
 * which spelling holds a value that is written.
 */
export function rejectComputedAssignment(
  host: ReactiveNamesHost,
  statement: Extract<Statement, { readonly kind: "AssignmentStatement" }>,
): boolean {
  if (statement.target.kind !== "IdentifierExpression") return false;
  const name = statement.target.name;
  if (!isComputedBinding(host, name)) return false;
  host.diagnostics.push(diagnostic(
    "VEL5063",
    isImportedComputedBinding(host, name)
      ? `'${name}' is a computed value derived in the module it comes from, so it has no location here to assign. Export a 'state' — or an action that writes one — and change that instead`
      : `'${name}' is a computed value: it is recomputed from what it reads and is never assigned. Assign the state it reads, or declare it 'state ${name} = ...' if this value is written directly`,
    statement.target.span,
  ));
  host.inferExpression(statement.value);
  return true;
}

/**
 * True when a name both belongs to a derived reactive declaration and still
 * resolves to one here: a computed accessor is a zero-argument function, and a
 * resource or action handle is a record with its reactive fields. An ordinary
 * binding that happens to share the name — a function parameter, a local — is
 * not a reactive read.
 */
export function derivedReactiveRead(host: ReactiveNamesHost, name: string): boolean {
  if (!host.derivedReactiveNames.has(name)) return false;
  const binding = host.lookup(name);
  if (!binding) return false;
  const type = host.expandAliases(binding.type);
  if (type.kind === "function" || type.kind === "action") return type.parameters.length === 0 && !type.rest;
  return type.kind === "object" && (type.fields.has("reload") || type.fields.has("pending"));
}
