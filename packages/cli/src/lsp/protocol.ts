/**
 * D115 P4 R4c — the LSP shapes and bounds every capability in `lsp/` shares.
 *
 * This module imports nothing. It is the leaf the rest of the directory hangs
 * from, so that a document shape or a limit has one definition and no two
 * collaborators here can import each other through it.
 */

/** The `params` member of a request, before a capability reads its own fields out of it. */
export type RequestParams = Record<string, unknown> | undefined;

export interface TextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
}

export interface Position {
  readonly line: number;
  readonly character: number;
}

export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export interface ContentChange {
  readonly range?: Range;
  readonly text: string;
}

export const VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION = 5;
export const MAX_LSP_RESULT_ITEMS = 10_000;
export const MAX_LSP_TEXT_CHARS = 64 * 1024;
export const MAX_EMITTED_JAVASCRIPT_CHARS = 4 * 1024 * 1024;
export const MAX_OWNERSHIP_GRAPH_NODES = 20_000;
export const MAX_OWNERSHIP_GRAPH_EDGES = 40_000;
export const semanticTokenTypes = [
  "type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter",
  "interface", "comment", "string", "keyword", "number", "regexp", "operator", "decorator",
] as const;
export const semanticTokenModifiers = ["declaration", "readonly", "static", "frameworkDefinition"] as const;

export const nonVelarDocumentResults = new Map<string, unknown>([
  ["textDocument/completion", { isIncomplete: false, items: [] }],
  ["textDocument/hover", null],
  ["textDocument/definition", null],
  ["textDocument/references", []],
  ["textDocument/documentHighlight", []],
  ["textDocument/prepareRename", null],
  ["textDocument/rename", null],
  ["textDocument/documentSymbol", []],
  ["textDocument/signatureHelp", null],
  ["textDocument/inlayHint", []],
  ["textDocument/semanticTokens/full", { data: [] }],
  ["textDocument/codeAction", []],
  ["textDocument/formatting", []],
]);
