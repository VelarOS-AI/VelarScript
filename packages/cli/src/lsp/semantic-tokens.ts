/** D115 P4 R4c — `textDocument/semanticTokens/full`, and the delta encoding the legend expects. */
import type { SourceText } from "@velarscript/compiler";
import { projectSemanticTokens, type ProjectSemanticToken } from "../project-semantic.ts";
import { pathOf } from "./paths.ts";
import { lspSourcePosition, sourceFor, type PositionContext } from "./positions.ts";
import {
  MAX_LSP_RESULT_ITEMS,
  semanticTokenModifiers,
  semanticTokenTypes,
  type RequestParams,
  type TextDocument,
} from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

function semanticTokenData(context: PositionContext, source: SourceText, tokens: readonly ProjectSemanticToken[]): number[] {
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of tokens) {
    const start = lspSourcePosition(context, source, token.span.start);
    const end = lspSourcePosition(context, source, token.span.end);
    if (start.line !== end.line || end.character <= start.character) continue;
    const line = start.line;
    const character = start.character;
    const deltaLine = line - previousLine;
    const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character;
    const tokenType = semanticTokenTypes.indexOf(token.type);
    if (tokenType < 0 || deltaLine < 0 || deltaCharacter < 0) continue;
    const modifiers = token.modifiers.reduce((bits, modifier) => {
      const index = semanticTokenModifiers.indexOf(modifier);
      return index < 0 ? bits : bits | (1 << index);
    }, 0);
    data.push(deltaLine, deltaCharacter, end.character - start.character, tokenType, modifiers);
    previousLine = line;
    previousCharacter = character;
  }
  return data;
}

/**
 * D38 §48: an editor quick fix is the same mechanical rewrite `velar fix`
 * applies, read from the diagnostic that named it. The compiler registers the
 * rewrite where it reports the diagnostic, so the editor never re-derives one
 * from message text and the two surfaces can never drift apart. D89: an
 * advisory that names one rewrite registers it the same way, so the editor
 * offers A2's swap as an ordinary quick fix; `velar fix` still reads
 * diagnostics only, because which name binds which value is a judgment.
 */

export async function semanticTokensFull(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  const tokens = path && project ? projectSemanticTokens(project, path).slice(0, MAX_LSP_RESULT_ITEMS) : [];
  session.respond(message.id, { data: project && path ? semanticTokenData(session, sourceFor(project, path), tokens) : [] });
}
