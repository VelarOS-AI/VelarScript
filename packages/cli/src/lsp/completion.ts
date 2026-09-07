/** D115 P4 R4c — `textDocument/completion`: what the project resolves, then what the language always offers. */
import { projectCompletionContextAt, projectCompletionsAt } from "../project-semantic.ts";
import { clipLspText } from "./diagnostics.ts";
import { completionItemsFor } from "./documentation.ts";
import { lspCompletionKind } from "./kinds.ts";
import { pathOf } from "./paths.ts";
import { offsetAt } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type Position, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function completion(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const offset = document ? offsetAt(session, document.text, position) : 0;
  const semantic = document && path && project ? projectCompletionsAt(project, path, offset) : [];
  const semanticItems = semantic.slice(0, MAX_LSP_RESULT_ITEMS).map((item) => ({
    label: clipLspText(item.label),
    kind: lspCompletionKind(item.presentationKind ?? item.kind),
    detail: clipLspText(item.detail),
    ...(item.documentation ? { documentation: { kind: "markdown", value: clipLspText(item.documentation) } } : {}),
    ...(item.insertText ? { insertText: clipLspText(item.insertText) } : {}),
    ...(item.filterText ? { filterText: clipLspText(item.filterText) } : {}),
    ...(item.sortText ? { sortText: clipLspText(item.sortText) } : {}),
    ...(item.snippet ? { insertTextFormat: 2 } : {}),
  }));
  const completionContext = document && path && project ? projectCompletionContextAt(project, path, offset) : "ordinary";
  const semanticLabels = new Set(semanticItems.map((item) => item.label));
  const generalItems = completionItemsFor(project).filter((item) => !semanticLabels.has(item.label)).map((item) => ({
    ...item,
    label: clipLspText(item.label),
    ...(item.detail ? { detail: clipLspText(item.detail) } : {}),
    ...(item.documentation ? { documentation: { kind: "markdown", value: clipLspText(item.documentation) } } : {}),
  }));
  const items = completionContext !== "ordinary"
    ? semanticItems
    : [...semanticItems, ...generalItems].slice(0, MAX_LSP_RESULT_ITEMS);
  session.respond(message.id, { isIncomplete: false, items });
}
