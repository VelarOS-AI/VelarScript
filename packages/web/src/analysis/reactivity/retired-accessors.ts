/**
 * The retired 'computed(...)' accessor: the intrinsic a call around it is still
 * typed by, and the shape of one declaration held for the migration message.
 *
 * D115 P4 R3a: a frozen table and a record shape, read by the analyzer and by
 * the intrinsic that types the call, so they read as a module.
 *
 * D115 P4 R3c: the migration pass itself joins them — what one declaration
 * records, what one read records, and the one message per site the whole-program
 * report writes — over a `RetiredAccessorHost`.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import { spanIdentity, unknownType, type Expression, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { isRetiredAccessorName } from "../reactive-names.ts";
import { diagnostic } from "../web-types.ts";

/**
 * `computed(...)` the function is answered with the signature it always had, so
 * a call written around it still type-checks instead of collapsing into an
 * unknown one — that is what keeps the one message about the declaration form
 * the only thing the author reads. `reactive.computed` itself is gone; this one
 * derives no reactivity and is never emitted, because every site that produces
 * it also produces an error. It stays an intrinsic only so the reader it
 * returns carries the callback's own result: an annotated declaration —
 * `const one: () -> number = computed(() => 1)` — would otherwise read a
 * second, spurious assignability error on top of it.
 */
/**
 * What the D71 migration off `computed(...)` the function asks: the four tables
 * it fills while the module is walked and reads once the walk has ended, and
 * the lookup that tells a global accessor apart from a binding of the name.
 */
export interface RetiredAccessorHost {
  /** Callee spans already claimed by a recognised `const x = computed(...)` declaration. */
  readonly migratedComputedCallees: Set<string>;
  /** Callee span identity -> call span, for every zero-argument call of a plain name. */
  readonly plainCallSpans: Map<string, Span>;
  readonly retiredAccessorDeclarations: Map<string, RetiredAccessorDeclaration>;
  readonly retiredAccessorReads: Map<string, Span[]>;
  readonly retiredComputedReferences: Map<string, { readonly name: string; readonly span: Span }>;

  readonly diagnostics: Diagnostic[];
  lookup(name: string): { readonly span: Span; readonly type: ValueType } | null;
}

export const RETIRED_ACCESSOR_INTRINSIC = "reactive.retired-accessor";
const retiredAccessorReaderType: ValueType = Object.freeze({ kind: "function", parameters: [], requiredParameters: 0, result: unknownType });
export const RETIRED_ACCESSOR_TYPE: ValueType = Object.freeze({
  kind: "intrinsic",
  name: RETIRED_ACCESSOR_INTRINSIC,
  parameterNames: ["read"],
  parameters: [retiredAccessorReaderType],
  requiredParameters: 1,
  result: retiredAccessorReaderType,
});

export interface RetiredAccessorDeclaration {
  readonly name: string;
  readonly exported: boolean;
  /** The named function the argument reads through, when it is one — `computed(readA)`. */
  readonly readName: string | null;
  readonly declarationSpan: Span;
  readonly callSpan: Span;
  /** The `() => E` body span, or null when the argument is not that shape. */
  readonly bodySpan: Span | null;
}

/**
 * D71 rule 183: `computed(...)` the function — the shape Vue and the signals
 * libraries teach — is not how a derived value is written here; the `computed`
 * declaration is. The declaration is recorded before the core walks the module
 * so its reads can be matched against it — the rewrite that removes the call
 * parentheses is only offered when every read is a plain `x()`.
 */
export function recordRetiredAccessorDeclaration(
  host: RetiredAccessorHost,
  statement: Extract<Statement, { readonly kind: "VariableDeclaration" }>,
): void {
  const initializer = statement.initializer;
  if (initializer.kind !== "CallExpression" || initializer.callee.kind !== "IdentifierExpression"
    || !isRetiredAccessorName(initializer.callee.name) || host.lookup(initializer.callee.name) !== null) return;
  if (statement.binding !== "const" || statement.pattern.kind !== "NameBindingPattern") return;
  const read = initializer.arguments.length === 1 && initializer.argumentNames === undefined
    ? initializer.arguments[0]! : null;
  // Only the `() => E` shape has a body that becomes the declaration's
  // initializer verbatim. Every other argument — a named function, a partial
  // application — would need the rewriter to invent an expression, so it is
  // left to the author with the call spelled out as its only mechanical answer.
  const body = read?.kind === "ArrowFunctionExpression" && !read.asynchronous && read.parameters.length === 0
    ? read.body : null;
  host.retiredAccessorDeclarations.set(spanIdentity(statement.pattern.span), {
    name: statement.pattern.name,
    exported: statement.exported,
    readName: read?.kind === "IdentifierExpression" ? read.name : null,
    declarationSpan: statement.span,
    callSpan: initializer.span,
    bodySpan: body ? body.span : null,
  });
  host.migratedComputedCallees.add(spanIdentity(initializer.callee.span));
}

/** Returns true when the name is one of the retired accessor globals this pass owns. */
export function recordRetiredAccessorRead(
  host: RetiredAccessorHost,
  expression: Extract<Expression, { readonly kind: "IdentifierExpression" }>,
): boolean {
  if (isRetiredAccessorName(expression.name)) {
    if (host.lookup(expression.name) !== null) return false;
    if (!host.migratedComputedCallees.has(spanIdentity(expression.span))) {
      host.retiredComputedReferences.set(spanIdentity(expression.span), { name: expression.name, span: expression.span });
    }
    return true;
  }
  const binding = host.lookup(expression.name);
  if (!binding) return false;
  const key = spanIdentity(binding.span);
  if (!host.retiredAccessorDeclarations.has(key)) return false;
  const reads = host.retiredAccessorReads.get(key);
  if (reads) reads.push(expression.span);
  else host.retiredAccessorReads.set(key, [expression.span]);
  return false;
}

/**
 * D71 migration: one message per site, and a mechanical rewrite only where
 * the compile can prove the rewrite. Where the
 * accessor is used as a value there is no second spelling left to offer, so
 * that site is told to declare the value and write an ordinary `def` where a
 * callable is what the caller wants — and it gets no edit, because moving a
 * reader out of a value position is the author's decision.
 */
export function reportRetiredComputedFunction(host: RetiredAccessorHost): void {
  for (const [key, accessor] of host.retiredAccessorDeclarations) {
    const reads = host.retiredAccessorReads.get(key) ?? [];
    const calls = reads.map((span) => host.plainCallSpans.get(spanIdentity(span)) ?? null);
    const rewritable = accessor.bodySpan !== null && calls.every((call) => call !== null);
    const edits = rewritable
      ? [
        { span: { start: accessor.declarationSpan.start, end: accessor.bodySpan!.start }, text: `${accessor.exported ? "export " : ""}computed ${accessor.name} = ` },
        { span: { start: accessor.bodySpan!.end, end: accessor.callSpan.end }, text: "" },
        ...reads.map((span, index) => ({ span: { start: span.end, end: calls[index]!.end }, text: "" })),
      ]
      : null;
    const alternative = accessor.bodySpan === null
      ? ` Where the argument is a function rather than an expression, write the call — 'computed ${accessor.name} = ${accessor.readName ?? "read"}()'`
      : ` Where the reader itself is passed on rather than read here, declare the value — 'computed ${accessor.name} = ...' — and write an ordinary 'def' where a callable is required`;
    host.diagnostics.push({
      code: "VEL5055",
      message: `A derived value is declared, not called: write 'computed ${accessor.name} = ...' and read '${accessor.name}' bare.${rewritable ? "" : alternative}`,
      span: accessor.declarationSpan,
      ...(edits ? { fix: { title: `Declare '${accessor.name}' with computed`, edits } } : {}),
    });
  }
  // There is no `fix`: the rewrite is a declaration, not a rename, and the
  // declaration form is offered above where the compile can see the whole
  // shape.
  for (const reference of host.retiredComputedReferences.values()) {
    host.diagnostics.push(diagnostic(
      "VEL5055",
      "'computed' declares a derived value — 'computed name = expression'. There is no function form, and 'computed' already caches",
      reference.span,
    ));
  }
}
