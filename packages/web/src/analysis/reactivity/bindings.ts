/**
 * Which declaration a name resolves to, and what follows from the answer: the
 * three binding-identity questions, the root a mutation lands on, and the
 * prop-specific wording a mutation of an explicitly readonly prop earns.
 *
 * D115 P4 R3c. Every question here is asked of the *binding* a name resolves
 * to, never of the spelling, which is why they all start at `lookup` — a local
 * `state` may shadow a derived or imported name, and the shadow is ordinary
 * writable state.
 */
import { spanIdentity, type Expression, type Statement } from "@velarscript/compiler/extension";
import { type ReactiveNamesHost } from "./host.ts";

/**
 * True when `name` resolves to a `computed` declaration or to an imported one.
 * The question is asked of the *binding* the name resolves to, never of the
 * spelling: a local `state` may shadow an imported derived name, and that
 * shadow is writable state.
 */
export function isComputedBinding(host: ReactiveNamesHost, name: string): boolean {
  const binding = host.lookup(name);
  return binding !== null && host.computedBindingSpans.has(spanIdentity(binding.span));
}

/**
 * True when `name` resolves to a `resource` declaration. Asked of the binding
 * rather than of the spelling, for the reason `isComputedBinding` is: a local
 * `state` may shadow a resource's name, and the shadow is not a resource.
 */
export function isResourceBinding(host: ReactiveNamesHost, name: string): boolean {
  const binding = host.lookup(name);
  return binding !== null && host.resourceBindingSpans.has(spanIdentity(binding.span));
}

export function isImportedComputedBinding(host: ReactiveNamesHost, name: string): boolean {
  const binding = host.lookup(name);
  return binding !== null && host.importedComputedSpans.has(spanIdentity(binding.span));
}

// A name refers to writable reactive state only when ordinary lexical lookup
// still resolves it to the state binding; a shadowing local wins instead.
export function writableStateName(host: ReactiveNamesHost, name: string): boolean {
  return host.reactiveBindingKind(name) === "state";
}

export function directReadonlyPropMutation(host: ReactiveNamesHost, statement: Statement): string | null {
  let target: Expression | null = null;
  if (statement.kind === "AssignmentStatement" && statement.target.kind !== "IdentifierExpression") {
    target = statement.target;
  } else if (statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression"
    && statement.expression.callee.kind === "MemberExpression") {
    target = statement.expression.callee.object;
  }
  if (!target) return null;
  const name = rootBindingName(target);
  if (!name) return null;
  const binding = host.lookup(name);
  return binding && host.explicitReadonlyPropBindings.get(name) === binding.span.start ? name : null;
}

export function rootBindingName(expression: Expression): string | null {
  if (expression.kind === "IdentifierExpression") return expression.name;
  if (expression.kind === "MemberExpression" || expression.kind === "IndexExpression") {
    return rootBindingName(expression.object);
  }
  if (expression.kind === "CallExpression" && expression.callee.kind === "MemberExpression") {
    return rootBindingName(expression.callee.object);
  }
  return null;
}

/**
 * D74: the readonly refusals the core raised while this statement was analyzed,
 * restated so they name the prop and the author's own contract. The cursor is
 * the diagnostic count taken before the core walked the statement, so only what
 * this statement earned is rewritten.
 */
export function restateReadonlyPropMutation(host: ReactiveNamesHost, firstDiagnostic: number, readonlyProp: string | null): void {
  if (!readonlyProp) return;
  for (let index = firstDiagnostic; index < host.diagnostics.length; index += 1) {
    const item = host.diagnostics[index]!;
    if ((item.code !== "VEL3002" && item.code !== "VEL4001") || !/read-?only|readonly/iu.test(item.message)) continue;
    host.diagnostics[index] = {
      ...item,
      message: `Cannot mutate prop '${readonlyProp}': this component's author explicitly declared it 'readonly'. ${item.message}`,
    };
  }
}
