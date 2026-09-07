/**
 * The three edits a Look diagnostic offers when its remedy names a builder.
 *
 * D115 P4 R3b. `values.ts` rewrites a raw CSS filter into the builder that
 * spells it and `tokens.ts` rewrites a `var(--x)` passthrough into `token()`,
 * so both need the same two answers — what this module already calls the
 * builder locally, and the import edit that gives the module the name when it
 * has none. They live here rather than in either caller because a helper both
 * read from the other would make the two import each other.
 */
import { type DiagnosticEdit } from "@velarscript/compiler";
import { type Expression } from "@velarscript/compiler/extension";
import { byCodeUnit } from "../../stable-order.ts";
import { type LookValueSite } from "../look-sites.ts";
import { type LookFilterRewrite } from "../look-vocabulary-guidance.ts";
import { type LookAnalysisHost } from "./host.ts";

/** Uses an existing alias when present and lists only builders the fix must import. */
export function localizeLookBuilderCall(host: LookAnalysisHost, rewrite: LookFilterRewrite): { readonly call: string; readonly missingImports: readonly string[] } {
  let call = rewrite.call;
  const missingImports: string[] = [];
  for (const builder of rewrite.builders) {
    const imported = [...host.lookBuilderNames].find(([, candidate]) => candidate === builder);
    const local = imported?.[0] ?? builder;
    if (!imported) missingImports.push(builder);
    call = call.replace(new RegExp(`\\b${builder}(?=\\()`, "gu"), local);
  }
  return { call, missingImports };
}

/** Rewrites either a Look entry expression or the synthetic value of a JSX Look directive. */
export function lookBuilderRewrite(
  host: LookAnalysisHost,
  value: Expression,
  call: string,
  site: LookValueSite,
  missingImports: readonly string[],
): readonly DiagnosticEdit[] {
  const wholeAttribute = site.directive !== null
    && value.span.start === site.entrySpan.start && value.span.end === site.entrySpan.end;
  const edit: DiagnosticEdit = {
    span: value.span,
    text: wholeAttribute ? `${site.directive!}:${site.property}={${call}}` : call,
  };
  return missingImports.length === 0 ? [edit] : [lookBuilderImportEdit(host, missingImports), edit];
}

/** Adds missing builders to the module's one velar/look import in stable order. */
export function lookBuilderImportEdit(host: LookAnalysisHost, builders: readonly string[]): DiagnosticEdit {
  const site = host.lookImport ?? { declaration: null, insertAt: 0, leadingBlankLine: true };
  const existing = site.declaration?.specifiers ?? [];
  const imported = new Set(existing.map((specifier) => specifier.imported));
  const specifiers = [
    ...existing,
    ...builders.filter((builder) => !imported.has(builder)).map((builder) => ({ imported: builder, local: builder })),
  ];
  const line = `import {${specifiers
    .sort((left, right) => byCodeUnit(left.imported, right.imported))
    .map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`)
    .join(", ")}} from "velar/look"`;
  if (site.declaration) return { span: site.declaration.span, text: line };
  return { span: { start: site.insertAt, end: site.insertAt }, text: site.leadingBlankLine ? `${line}\n\n` : `\n${line}` };
}
