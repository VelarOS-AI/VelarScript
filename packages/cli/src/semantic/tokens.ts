import type { EmbeddedJavaScriptEditorToken, SemanticSymbol, Span } from "@velarscript/compiler";
import {
  isFrameworkDefinitionSymbol,
  isReactiveFrameworkVariableSymbol,
  semanticTokenModifiers,
  semanticTokenType,
  type ProjectSemanticTokenType,
} from "../lsp/semantic-token-roles.ts";
import type { ProjectResult } from "../project.ts";
import { moduleAt } from "./locations.ts";
import { projectMemberSymbolAt, projectSymbolAt } from "./symbol-lookup.ts";
import type { ProjectSemanticToken } from "./types.ts";

export function projectSemanticTokens(project: ProjectResult, path: string): readonly ProjectSemanticToken[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const tokens = new Map<string, { readonly token: ProjectSemanticToken; readonly priority: number }>();
  const add = (
    span: Span,
    symbol: SemanticSymbol | null,
    fallback: ProjectSemanticTokenType,
    declaration: boolean,
    priority: number,
    frameworkDefinition = false,
  ): void => {
    if (span.end <= span.start) return;
    const token = {
      span,
      type: symbol ? semanticTokenType(symbol) : fallback,
      modifiers: symbol ? semanticTokenModifiers(symbol, declaration, frameworkDefinition) : declaration ? ["declaration" as const] : [],
    } satisfies ProjectSemanticToken;
    const key = `${span.start}:${span.end}`;
    if ((tokens.get(key)?.priority ?? -1) < priority) tokens.set(key, { token, priority });
  };
  const addEmbedded = (token: EmbeddedJavaScriptEditorToken): void => {
    if (token.span.end <= token.span.start) return;
    const key = `${token.span.start}:${token.span.end}`;
    const projectToken = {
      span: token.span,
      type: token.type,
      modifiers: token.modifiers,
    } satisfies ProjectSemanticToken;
    if ((tokens.get(key)?.priority ?? -1) < 6) tokens.set(key, { token: projectToken, priority: 6 });
  };

  for (const token of module.result.semanticIndex.syntaxTokens) {
    add(token.span, null, token.kind, false, 4);
  }
  for (const token of module.result.embeddedJavaScriptTokens) addEmbedded(token);

  for (const symbol of module.result.semanticIndex.symbols) {
    const resolved = projectSymbolAt(project, path, symbol.selectionSpan.start) ?? symbol;
    add(symbol.selectionSpan, resolved, "variable", true, 3, isFrameworkDefinitionSymbol(symbol));
  }
  for (const reference of module.result.semanticIndex.references) {
    const resolved = projectSymbolAt(project, path, reference.span.start);
    add(reference.span, resolved, "variable", false, 1);
  }
  for (const reference of module.result.semanticIndex.memberReferences) {
    if (reference.syntax === "object-key" && reference.shorthand) {
      const binding = projectSymbolAt(project, path, reference.span.start);
      const bindingType = binding ? semanticTokenType(binding) : null;
      const retainsBindingRole = bindingType === "function" || bindingType === "method"
        || (binding !== null && isReactiveFrameworkVariableSymbol(binding));
      add(reference.span, retainsBindingRole ? binding : null, "property", false, 5);
      continue;
    }

    const resolved = projectMemberSymbolAt(project, path, reference.span.start);
    const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan
      && item.selectionSpan.start === reference.span.start && item.selectionSpan.end === reference.span.end);
    add(reference.span, resolved, expression?.callable ? "method" : "property", false, 2);
  }

  return [...tokens.values()].map((item) => item.token).sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}
