/** D115 P4 R4c — `textDocument/documentSymbol`: one module's declarations, in source order. */
import { projectDocumentSymbols } from "../project-semantic.ts";
import { clipLspText } from "./diagnostics.ts";
import { lspSymbolKind } from "./kinds.ts";
import { pathOf } from "./paths.ts";
import { lspRange, sourceFor } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function documentSymbol(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  session.respond(message.id, path && project ? projectDocumentSymbols(project, path).slice(0, MAX_LSP_RESULT_ITEMS).map((symbol) => ({
    name: clipLspText(symbol.name),
    ...(symbol.type ? { detail: clipLspText(symbol.type) } : {}),
    kind: lspSymbolKind(symbol.presentationKind ?? symbol.kind),
    range: lspRange(session, sourceFor(project, symbol.path), symbol.span),
    selectionRange: lspRange(session, sourceFor(project, symbol.path), symbol.selectionSpan),
  })) : []);
}
