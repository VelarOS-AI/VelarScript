/** D115 P4 R4c — `textDocument/formatting`: no edits is the honest answer when the formatter is unsure. */
import { formatSourceChecked } from "../format-guard.ts";
import { fullRange } from "./positions.ts";
import type { RequestParams, TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function formatting(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const document = session.documents.get(descriptor.uri);
  if (!document) {
    session.respond(message.id, []);
    return;
  }
  const project = await session.projectFor(document);
  const { text: formatted, stable, blocked } = formatSourceChecked(document.text, { extensions: project?.compilerExtensions ?? [] });
  // Formatting is idempotent by contract, so a result the formatter would
  // change again is a formatter defect. Offering it as an edit hands
  // format-on-save a module the next save corrupts, and an editor cannot
  // undo what it never saw as a change; no edits is the honest answer.
  //
  // D114 0.28.0 I-D1: a document that does not parse gets the same answer
  // for the same reason. The editor is already showing the parse
  // diagnostic on the line that caused it; what it must not do is rewrite
  // an unparsed buffer on save.
  session.respond(message.id, blocked !== null || !stable || formatted === document.text
    ? []
    : [{ range: fullRange(session, document.text), newText: formatted }]);
}
