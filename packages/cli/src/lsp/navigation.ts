/** D115 P4 R4c — `definition`, `references`, and `documentHighlight`: the same resolution, three shapes. */
import { projectDefinitionAt, projectReferencesAt } from "../project-semantic.ts";
import { pathOf } from "./paths.ts";
import { lspLocation, lspRange, offsetAt, sourceFor } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type Position, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function definition(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const location = document && path && project ? projectDefinitionAt(project, path, offsetAt(session, document.text, position)) : null;
  session.respond(message.id, location && project ? lspLocation(session, project, location.path, location.span) : null);
}

export async function references(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const context = params?.context as { readonly includeDeclaration?: boolean } | undefined;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const locations = document && path && project
    ? projectReferencesAt(project, path, offsetAt(session, document.text, position), context?.includeDeclaration ?? false)
        .slice(0, MAX_LSP_RESULT_ITEMS)
    : [];
  session.respond(message.id, project ? locations.map((location) => lspLocation(session, project, location.path, location.span)) : []);
}

export async function documentHighlight(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const locations = document && path && project
    ? projectReferencesAt(project, path, offsetAt(session, document.text, position), true)
        .filter((location) => location.path === path)
        .slice(0, MAX_LSP_RESULT_ITEMS)
    : [];
  session.respond(message.id, project && path ? locations.map((location) => ({
    range: lspRange(session, sourceFor(project, path), location.span),
    kind: 1,
  })) : []);
}
