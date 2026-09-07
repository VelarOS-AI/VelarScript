/**
 * D115 P4 R4c — the VelarScript Language Server, as a facade over `lsp/`.
 *
 * What is left here is the shape of the server and nothing else: build the
 * session, wire the transport to a `handle` that names one module per LSP
 * method, and wait for the client to leave. Every answer lives in the module
 * for its capability, and every one of them says which part of the session it
 * reads rather than closing over all of it — which is what the previous
 * 880-line `runLanguageServer` and its 635-line `handle` made impossible.
 *
 * `completionItemsFor` stays exported from this path because three tests read
 * the completion roster without starting a server.
 */
import { codeAction } from "./lsp/code-actions.ts";
import { completion } from "./lsp/completion.ts";
import { didChange, didChangeWatchedFiles, didClose, didOpen, didSave } from "./lsp/documents.ts";
import { emittedJavaScript } from "./lsp/emitted-javascript.ts";
import { formatting } from "./lsp/formatting.ts";
import { hoverAt } from "./lsp/hover.ts";
import { inlayHint } from "./lsp/inlay-hints.ts";
import { exit, initialize, initialized, shutdown } from "./lsp/lifecycle.ts";
import { definition, documentHighlight, references } from "./lsp/navigation.ts";
import { ownershipGraph } from "./lsp/ownership-graph.ts";
import { isVelarDocument } from "./lsp/paths.ts";
import { nonVelarDocumentResults, type TextDocument } from "./lsp/protocol.ts";
import { prepareRename, rename } from "./lsp/rename.ts";
import { semanticTokensFull } from "./lsp/semantic-tokens.ts";
import { createSession } from "./lsp/session.ts";
import { signatureHelp } from "./lsp/signature-help.ts";
import { documentSymbol } from "./lsp/symbols.ts";
import { listenToTransport, requestKey, type RpcMessage } from "./lsp/transport.ts";
import { workspaceRescan, workspaceSearch, workspaceSymbol } from "./lsp/workspace.ts";

export { VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION } from "./lsp/protocol.ts";
export { completionItemsFor } from "./lsp/documentation.ts";

export async function runLanguageServer(): Promise<void> {
  const session = await createSession();
  const handle = async (message: RpcMessage): Promise<void> => {
    if (message.id !== undefined && session.cancelledRequests.has(requestKey(message.id))) {
      session.respondError(message.id, "Request cancelled", -32800);
      return;
    }
    if (session.shuttingDown && message.method !== "exit") {
      if (message.id !== undefined) session.respondError(message.id, "VelarScript Language Server is shutting down", -32600);
      return;
    }
    const params = message.params as Record<string, unknown> | undefined;
    if (message.id !== undefined && message.method && nonVelarDocumentResults.has(message.method)) {
      const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
      const document = descriptor?.uri ? session.documents.get(descriptor.uri) : undefined;
      if (document && !isVelarDocument(document)) {
        session.respond(message.id, nonVelarDocumentResults.get(message.method));
        return;
      }
    }
    switch (message.method) {
      case "initialize": initialize(session, message, params); break;
      case "initialized": initialized(session); break;
      case "shutdown": shutdown(session, message); break;
      case "exit": exit(session); break;
      case "$/cancelRequest": break;
      case "textDocument/didOpen": await didOpen(session, message, params); break;
      case "textDocument/didChange": didChange(session, message, params); break;
      case "textDocument/didSave": didSave(session, message, params); break;
      case "textDocument/didClose": await didClose(session, message, params); break;
      case "workspace/didChangeWatchedFiles": await didChangeWatchedFiles(session, message, params); break;
      case "velar/workspaceRescan": await workspaceRescan(session, message, params); break;
      case "velar/workspaceSearch": await workspaceSearch(session, message, params); break;
      case "velar/ownershipGraph": await ownershipGraph(session, message, params); break;
      case "velar/emittedJavaScript": await emittedJavaScript(session, message, params); break;
      case "workspace/symbol": await workspaceSymbol(session, message, params); break;
      case "textDocument/completion": await completion(session, message, params); break;
      case "textDocument/hover": await hoverAt(session, message, params); break;
      case "textDocument/definition": await definition(session, message, params); break;
      case "textDocument/references": await references(session, message, params); break;
      case "textDocument/documentHighlight": await documentHighlight(session, message, params); break;
      case "textDocument/prepareRename": await prepareRename(session, message, params); break;
      case "textDocument/rename": await rename(session, message, params); break;
      case "textDocument/documentSymbol": await documentSymbol(session, message, params); break;
      case "textDocument/signatureHelp": await signatureHelp(session, message, params); break;
      case "textDocument/inlayHint": await inlayHint(session, message, params); break;
      case "textDocument/semanticTokens/full": await semanticTokensFull(session, message, params); break;
      case "textDocument/codeAction": await codeAction(session, message, params); break;
      case "textDocument/formatting": await formatting(session, message, params); break;
      default:
        if (message.id !== undefined) session.respondError(message.id, `Method not found: ${message.method ?? ""}`, -32601);
    }
  };

  listenToTransport(session, handle);
  await Promise.race([new Promise<void>((resolve) => process.stdin.once("end", resolve)), session.exitRequested]);
  await session.queue;
  if (session.diagnosticTask) await session.diagnosticTask;
}
