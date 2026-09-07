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
  return [...lookImportEdits(host, missingImports), edit];
}

/**
 * The one import edit a Look rewrite needs, or none when the import line it
 * would write is the line already there.
 *
 * D114 WB-I2: a rewrite gives a module a name and can equally take one away.
 * `color("var(--brand)")` becomes `token("--brand")`, and the run that made that
 * edit knew both that `token` had to arrive and that this was the module's last
 * read of `color` — yet it left the dead specifier behind, so `velar fix`
 * finished by writing an import of a builder the file no longer calls. `retiring`
 * names the locals the rewrite consumes the last read of; a name still read
 * somewhere else keeps its specifier.
 */
export function lookImportEdits(
  host: LookAnalysisHost,
  builders: readonly string[],
  retiring: readonly string[] = [],
): readonly DiagnosticEdit[] {
  const site = host.lookImport ?? { declaration: null, insertAt: 0, leadingBlankLine: true };
  const existing = site.declaration?.specifiers ?? [];
  const imported = new Set(existing.map((specifier) => specifier.imported));
  const dropped = new Set(existing.filter((specifier) => retiring.includes(specifier.local) && specifier.reads <= 1));
  const additions = builders.filter((builder) => !imported.has(builder));
  if (additions.length === 0 && dropped.size === 0) return [];
  const specifiers = [
    ...existing.filter((specifier) => !dropped.has(specifier)),
    ...additions.map((builder) => ({ imported: builder, local: builder })),
  ];
  // A module whose only look import was the name this rewrite retired keeps no
  // empty import line: `import {} from "velar/look"` imports nothing and is not
  // what the file should hold. The trailing character is the line break the
  // declaration ends before, which is how the retired-import migration removes
  // an import statement as well.
  if (specifiers.length === 0 && site.declaration) {
    return [{ span: { start: site.declaration.span.start, end: site.declaration.span.end + 1 }, text: "" }];
  }
  const line = `import {${specifiers
    .sort((left, right) => byCodeUnit(left.imported, right.imported))
    .map((specifier) => specifier.imported === specifier.local ? specifier.imported : `${specifier.imported} as ${specifier.local}`)
    .join(", ")}} from "velar/look"`;
  if (site.declaration) return [{ span: site.declaration.span, text: line }];
  return [{ span: { start: site.insertAt, end: site.insertAt }, text: site.leadingBlankLine ? `${line}\n\n` : `\n${line}` }];
}
