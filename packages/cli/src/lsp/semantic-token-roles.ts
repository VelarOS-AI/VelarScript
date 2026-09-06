import type { SemanticSymbol } from "@velarscript/compiler";

export type ProjectSemanticTokenType = "type" | "class" | "enum" | "enumMember" | "function" | "method" | "property" | "variable" | "parameter" | "keyword" | "decorator";
export type ProjectSemanticTokenModifier = "declaration" | "readonly" | "static" | "frameworkDefinition";

/** Presentation roles for compiler-resolved symbols, shared by all token positions. */
export function semanticTokenType(symbol: SemanticSymbol): ProjectSemanticTokenType {
  if (symbol.kind === "import" && symbol.callable) return "function";
  if (symbol.kind.startsWith("extension:function:")) return "function";
  if (symbol.kind.startsWith("extension:parameter:")) return "parameter";
  if (symbol.kind.startsWith("extension:type:")) return "type";
  if (symbol.kind.startsWith("extension:class:")) return "class";
  switch (symbol.kind) {
    case "type": return "type";
    case "class": return "class";
    case "enum": return "enum";
    case "enum-member": return "enumMember";
    case "function":
      return "function";
    case "method": return "method";
    case "field": return "property";
    case "parameter": return "parameter";
    default: return "variable";
  }
}

const reactiveFrameworkVariableKinds = new Set<SemanticSymbol["kind"]>([
  "extension:variable:web-computed",
  "extension:variable:web-resource",
  "extension:variable:web-state",
]);

const frameworkDefinitionKinds = new Set<SemanticSymbol["kind"]>([
  "extension:function:web-action",
  "extension:function:web-component",
  "extension:variable:node-server",
  ...reactiveFrameworkVariableKinds,
]);

export function isFrameworkDefinitionSymbol(symbol: SemanticSymbol): boolean {
  return frameworkDefinitionKinds.has(symbol.kind);
}

export function isReactiveFrameworkVariableSymbol(symbol: SemanticSymbol): boolean {
  return reactiveFrameworkVariableKinds.has(symbol.kind);
}

export function semanticTokenModifiers(
  symbol: SemanticSymbol,
  declaration: boolean,
  frameworkDefinition = false,
): readonly ProjectSemanticTokenModifier[] {
  const modifiers: ProjectSemanticTokenModifier[] = [];
  if (declaration) modifiers.push("declaration");
  if ((symbol.kind === "variable" || symbol.kind.startsWith("extension:variable:")) && !symbol.mutable) modifiers.push("readonly");
  if (symbol.static) modifiers.push("static");
  // Reactive variables keep the declaration's presentation wherever this exact
  // symbol is read or written. The resolved symbol also preserves imports and
  // lexical shadowing, while resource fields retain their own property role.
  if (frameworkDefinition || isReactiveFrameworkVariableSymbol(symbol)) modifiers.push("frameworkDefinition");
  return modifiers;
}
