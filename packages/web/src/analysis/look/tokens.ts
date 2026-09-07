/**
 * D103 — the design-token reference: what `token()` has to be at the site that
 * writes it, and the migration off the `color("var(--x)")` passthrough that
 * used to be the only spelling a Look value let through unchecked.
 *
 * D115 P4 R3b. The compiler cannot see a design system's values, so the
 * reference itself is the whole of what there is to check; every rule here is
 * about the written name.
 */
import { type DiagnosticEdit, mechanicalEdits, mechanicalFix } from "@velarscript/compiler";
import { type Expression, spanIdentity } from "@velarscript/compiler/extension";
import { isLookTokenName, isLookVarReference, LOOK_PROPERTY_VALUE_KINDS, LOOK_TOKEN_NAME_RULE, LOOK_TOKEN_NO_FALLBACK_GUIDANCE, lookTokenReference, lookVarReferenceName } from "../../look.ts";
import { type LookValueSite } from "../look-sites.ts";
import { diagnostic } from "../web-types.ts";
import { lookBuilderImportEdit } from "./edits.ts";
import { type LookAnalysisHost } from "./host.ts";

/**
 * D103 rules 1 and 5 — what a checked token reference has to be at the site
 * that writes it.
 *
 * The compiler cannot see a design system's values: no token stylesheet is an
 * input to this compile, and the whole point of the contract is that the
 * theme swaps values under the same names. So the reference itself is the
 * only thing there is to check, and it is checked completely — a literal
 * name, spelled as a CSS custom property identifier, and nothing else in the
 * call. A computed name would leave a Look value with no checked part at all,
 * which is the surface D50 rule 92 says is worse than none.
 */
export function checkLookTokenCall(host: LookAnalysisHost, expression: Extract<Expression, { kind: "CallExpression" }>): void {
  const names = expression.argumentNames;
  // `token(name="--x")` writes the same one argument the positional spelling
  // does, so the name position is read from the signature the way every other
  // builder's is rather than assumed to be index 0.
  const position = names?.findIndex((entry) => entry === "name") ?? -1;
  const nameIndex = position >= 0 ? position : names?.[0] === undefined || names[0] === null ? 0 : -1;
  for (const [index, argument] of expression.arguments.entries()) {
    if (index === nameIndex) continue;
    host.diagnostics.push(diagnostic("VEL5042", LOOK_TOKEN_NO_FALLBACK_GUIDANCE, argument.span));
  }
  const written = nameIndex >= 0 ? expression.arguments[nameIndex] : undefined;
  if (!written) return;
  if (written.kind !== "LiteralExpression" || typeof written.value !== "string") {
    host.diagnostics.push(diagnostic(
      "VEL5042",
      `A design token reference names its custom property in the call: ${LOOK_TOKEN_NAME_RULE}. The compiler cannot see a design system's values, so the name is the whole of what it can check — a computed name, an interpolation, or a binding would leave the reference unchecked`,
      written.span,
    ));
    return;
  }
  if (isLookTokenName(written.value)) {
    // D103 rule 2: the reference is compile-time text, so it is folded here
    // rather than left as a call the browser makes on every module load. The
    // fold is stamped only on a call this check has just proved, which is
    // what keeps the emitter structurally unable to write a name nothing
    // validated. An aliased builder (`const t = token`) is not resolved here
    // and keeps the runtime implementation, exactly as every other builder
    // passed around as a value does.
    if (expression.arguments.length === 1) {
      host.extensionLiterals.set(spanIdentity(expression.span), lookTokenReference(written.value));
    }
    return;
  }
  // A name written without the `--` that makes it a custom property is the
  // one near miss with a single spelling behind it, so it is migrated rather
  // than only refused.
  const prefixed = `--${written.value}`;
  host.diagnostics.push(diagnostic(
    "VEL5042",
    `Design token name '${written.value}' is not a CSS custom property identifier; ${LOOK_TOKEN_NAME_RULE}`,
    written.span,
    isLookTokenName(prefixed)
      ? mechanicalFix(written.span, JSON.stringify(prefixed), `Use "${prefixed}"`)
      : undefined,
  ));
}

/**
 * D103 rule 4 — the migration off the one passthrough that used to work.
 *
 * The rewrite carries the `token` import when the module does not already
 * have one, because a fix that leaves a module naming an unimported builder
 * is not mechanical. A `var(--x, fallback)` reference has no rewrite: rule 5
 * closed the contract against per-site fallbacks, so the message says that
 * rather than offering a migration that would silently drop the fallback.
 */
export function reportLookColorVarReference(
  host: LookAnalysisHost,
  expression: Extract<Expression, { kind: "CallExpression" }>,
  argument: Expression,
): void {
  if (argument.kind !== "LiteralExpression" || typeof argument.value !== "string") return;
  if (!isLookVarReference(argument.value)) return;
  const referenced = lookVarReferenceName(argument.value);
  if (referenced === null) {
    host.diagnostics.push(diagnostic(
      "VEL5042",
      `A design token reference is written token("--name"), and it carries no fallback: ${LOOK_TOKEN_NO_FALLBACK_GUIDANCE}`,
      argument.span,
    ));
    return;
  }
  const { call, imported } = lookTokenCallText(host, referenced);
  const rewrite: DiagnosticEdit = { span: expression.span, text: call };
  host.diagnostics.push(diagnostic(
    "VEL5042",
    `Write a design token reference as ${call}; color("var(...)") passed the reference through as text nothing checked, and token() is the one checked spelling — legal in every Look property, not only the colour ones`,
    expression.span,
    mechanicalEdits(imported ? [rewrite] : [lookTokenImportEdit(host), rewrite], `Use ${call}`),
  ));
}

/** The one edit that gives this module a `token` import, in the shape D103's migration needs. */
export function lookTokenImportEdit(host: LookAnalysisHost): DiagnosticEdit {
  return lookBuilderImportEdit(host, ["token"]);
}

/** Whether this value is written as a call to the module's `token` builder, alias included. */
export function isLookTokenCall(host: LookAnalysisHost, value: Expression): boolean {
  return value.kind === "CallExpression" && value.callee.kind === "IdentifierExpression"
    && host.lookBuilderNames.get(value.callee.name) === "token";
}

/** How this module spells a call to the token builder, honouring an aliased import. */
export function lookTokenCallText(host: LookAnalysisHost, referenced: string): { readonly call: string; readonly imported: boolean } {
  const local = [...host.lookBuilderNames].find(([, builder]) => builder === "token")?.[0] ?? null;
  return { call: `${local ?? "token"}(${JSON.stringify(referenced)})`, imported: local !== null };
}

/**
 * The edits that replace one written Look value with the checked token call,
 * in the spelling of the site that wrote it.
 *
 * A `look:property="text"` directive is analyzed through a synthetic literal
 * standing for the whole attribute, so the rewrite replaces the attribute:
 * splicing a call between an attribute's quotes is not JSX, and a fix that
 * produces a parse error is not a mechanical fix. The `look:property={...}`
 * spelling carries a real expression whose span is the value alone, and is
 * rewritten in place like a block entry.
 */
export function lookTokenRewrite(host: LookAnalysisHost, value: Expression, referenced: string, site: LookValueSite): readonly DiagnosticEdit[] {
  const { call, imported } = lookTokenCallText(host, referenced);
  const wholeAttribute = site.directive !== null
    && value.span.start === site.entrySpan.start && value.span.end === site.entrySpan.end;
  const edit: DiagnosticEdit = {
    span: value.span,
    text: wholeAttribute ? `${site.directive!}:${site.property}={${call}}` : call,
  };
  return imported ? [edit] : [lookTokenImportEdit(host), edit];
}

/**
 * D103 rule 4, free-text half — an advisory rather than a refusal.
 *
 * `fontFamily`, `backdropFilter` and the other free-text kinds accept
 * arbitrary CSS text by construction, and a `var()` inside a larger value is
 * a legitimate spelling with no single token to rewrite it to: the tail of a
 * font stack, one layer of a filter list. Refusing there would refuse real
 * CSS. What is advised is the narrow case where the *whole* value is one
 * reference, because there `token("--name")` is the checked spelling of the
 * same thing and the rewrite is unambiguous — which is the bar the `A`
 * roster is written to.
 */
export function adviseLookTokenSpelling(host: LookAnalysisHost, name: string, value: Expression, site: LookValueSite): void {
  const kind = LOOK_PROPERTY_VALUE_KINDS.get(name);
  if (kind !== "text" && kind !== "filter" && kind !== "transform") return;
  if (value.kind !== "LiteralExpression" || typeof value.value !== "string") return;
  const referenced = lookVarReferenceName(value.value);
  if (referenced === null) return;
  const { call } = lookTokenCallText(host, referenced);
  host.advise(
    "A12",
    `Look property '${name}' accepts free text, so this design token reference compiles — as text nothing checks. ${call} is the checked spelling of the same reference, and it is legal in every Look property. A var() inside a larger value, such as a font stack's fallback, has no single token to stand for it and is not advised`,
    value.span,
    mechanicalEdits(lookTokenRewrite(host, value, referenced, site), `Use ${call}`),
  );
}
