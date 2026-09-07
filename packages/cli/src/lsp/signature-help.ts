/** D115 P4 R4c — `textDocument/signatureHelp`: the checked signature of the call being written. */
import { projectSignatureAt } from "../project-semantic.ts";
import { clipLspText } from "./diagnostics.ts";
import { pathOf } from "./paths.ts";
import { offsetAt } from "./positions.ts";
import type { Position, RequestParams, TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function signatureHelp(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const signature = document && path && project ? projectSignatureAt(project, path, offsetAt(session, document.text, position)) : null;
  session.respond(message.id, signature ? {
    signatures: [{ label: clipLspText(signature.label) }],
    activeSignature: 0,
    activeParameter: signature.activeParameter,
  } : null);
}
