export type ScriptLanguage = "javascript" | "typescript";
export type ScriptTokenKind = "identifier" | "keyword" | "number" | "string" | "template" | "regexp" | "comment" | "punctuation" | "operator";
export type ScriptDiagnosticSeverity = "error" | "warning";
export type ScriptSymbolKind = "variable" | "constant" | "function" | "parameter" | "class" | "interface" | "type" | "enum" | "import";

export interface ScriptSpan {
  readonly start: number;
  readonly end: number;
}

export interface ScriptToken extends ScriptSpan {
  readonly kind: ScriptTokenKind;
  readonly text: string;
}

export interface ScriptDiagnostic extends ScriptSpan {
  readonly code: string;
  readonly message: string;
  readonly severity: ScriptDiagnosticSeverity;
}

export interface ScriptSymbol extends ScriptSpan {
  readonly id: number;
  readonly name: string;
  readonly kind: ScriptSymbolKind;
  readonly scopeStart: number;
  readonly scopeEnd: number;
  readonly type: string;
}

export interface ScriptReference extends ScriptSpan {
  readonly symbolId: number;
  readonly write: boolean;
}

export interface ScriptCompletion {
  readonly label: string;
  readonly kind: ScriptSymbolKind;
  readonly detail: string;
}

export interface ScriptHover extends ScriptSpan {
  readonly contents: string;
}

export interface ScriptEdit extends ScriptSpan {
  readonly replacement: string;
}

export interface ScriptRename {
  readonly placeholder: string | null;
  readonly edits: readonly ScriptEdit[];
  readonly error: string | null;
}

export interface ScriptAnalysis {
  readonly tokens: readonly ScriptToken[];
  readonly diagnostics: readonly ScriptDiagnostic[];
  readonly symbols: readonly ScriptSymbol[];
  readonly references: readonly ScriptReference[];
}

export interface ScriptActivity {
  readonly revision: number;
  readonly incremental: boolean;
  readonly restartOffset: number;
  readonly codePointsRead: number;
  readonly tokensReused: number;
  readonly totalTokens: number;
}

export interface ScriptDocumentOwner {
  readonly language: ScriptLanguage;
  readonly revision: number;
  readonly text: string;
  analysis(): ScriptAnalysis;
  activity(): ScriptActivity;
  update(text: string): ScriptActivity;
  apply(edits: readonly ScriptEdit[]): ScriptActivity;
  tokenAt(offset: number): ScriptToken | null;
  symbolAt(offset: number): ScriptSymbol | null;
  definitionAt(offset: number): ScriptSpan | null;
  referencesAt(offset: number, includeDeclaration?: boolean): readonly ScriptSpan[];
  hoverAt(offset: number): ScriptHover | null;
  completionsAt(offset: number): readonly ScriptCompletion[];
  renameAt(offset: number, replacement: string): ScriptRename;
}

export interface ScriptLanguageServiceProvider {
  create(language: ScriptLanguage, text: string): ScriptDocumentOwner;
}

let provider: ScriptLanguageServiceProvider | null = null;

export function registerScriptLanguageService(value: ScriptLanguageServiceProvider): void {
  if (provider && provider !== value) throw new Error("Only one official script language service may be registered");
  provider = value;
}

export function createScriptLanguageDocument(language: ScriptLanguage, text: string): ScriptDocumentOwner | null {
  return provider?.create(language, text) ?? null;
}

export function scriptLanguageFor(path: string, languageId: string): ScriptLanguage | null {
  const normalized = languageId.toLowerCase();
  if (normalized === "javascript" || normalized === "javascriptreact" || /\.(?:js|mjs|cjs|jsx)$/iu.test(path)) return "javascript";
  if (normalized === "typescript" || normalized === "typescriptreact" || /\.(?:ts|mts|cts|tsx)$/iu.test(path)) return "typescript";
  return null;
}
