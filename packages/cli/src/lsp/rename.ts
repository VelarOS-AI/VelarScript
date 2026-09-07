/** D115 P4 R4c — `prepareRename` and `rename`: a rename the project refuses is an error, not empty edits. */
import { projectPrepareRenameAt, projectRenameAt } from "../project-semantic.ts";
import { pathOf } from "./paths.ts";
import { lspRange, offsetAt, sourceFor, workspaceEdit } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type Position, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function prepareRename(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const prepared = document && path && project ? projectPrepareRenameAt(project, path, offsetAt(session, document.text, position)) : null;
  const selection = prepared?.edits[0];
  session.respond(message.id, selection && project ? { range: lspRange(session, sourceFor(project, selection.path), selection.span), placeholder: prepared.placeholder } : null);
}

export async function rename(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const newName = params?.newName as string;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const renamed = document && path && project ? projectRenameAt(project, path, offsetAt(session, document.text, position), newName) : "No renameable VelarScript symbol at this position";
  if (typeof renamed === "string") session.respondError(message.id, renamed);
  else if (renamed.edits.length > MAX_LSP_RESULT_ITEMS) session.respondError(message.id, `Rename affects more than ${MAX_LSP_RESULT_ITEMS} locations`);
  else session.respond(message.id, project ? workspaceEdit(session, project, renamed.edits, newName) : null);
}
