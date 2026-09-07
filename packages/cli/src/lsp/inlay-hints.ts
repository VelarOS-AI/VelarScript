/** D115 P4 R4c — `textDocument/inlayHint`: the inferred type after a declaration that omitted one. */
import type { ProjectResult } from "../project.ts";
import { pathOf } from "./paths.ts";
import { lineEndAt, lspSourcePosition, offsetAt, type PositionContext } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type Range, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

function projectInlayHints(context: PositionContext, project: ProjectResult, path: string, text: string, range?: Range): unknown[] {
  const module = project.modules.find((item) => item.inputPath === path);
  if (!module) return [];
  const start = range ? offsetAt(context, text, range.start) : 0;
  const end = range ? offsetAt(context, text, range.end) : text.length;
  const hints: unknown[] = [];
  for (const symbol of module.result.semanticIndex.symbols) {
    if (hints.length >= MAX_LSP_RESULT_ITEMS) break;
    if (!symbol.sourceTypeHint || !symbol.type || symbol.type.length > 1024) continue;
    if (symbol.selectionSpan.end < start || symbol.selectionSpan.end > end) continue;
    const declarationEnd = lineEndAt(text, symbol.selectionSpan.end);
    const assignment = text.indexOf("=", symbol.selectionSpan.end);
    if (assignment !== -1 && assignment < declarationEnd && text.slice(symbol.selectionSpan.end, assignment).includes(":")) continue;
    const location = lspSourcePosition(context, module.result.source, symbol.selectionSpan.end);
    hints.push({
      position: location,
      label: `: ${symbol.type}`,
      kind: 1,
      paddingRight: true,
    });
  }
  return hints;
}

export async function inlayHint(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const range = params?.range as Range | undefined;
  const document = session.documents.get(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  const project = document ? await session.projectFor(document) : null;
  session.respond(message.id, document && path && project ? projectInlayHints(session, project, path, document.text, range) : []);
}
