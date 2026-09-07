/** D115 P4 R4c — `textDocument/codeAction`: the quick fixes the compiler registered. */
import type { ProjectModule } from "../project.ts";
import { boundedDiagnosticSpan } from "./diagnostics.ts";
import { pathOf } from "./paths.ts";
import { lspRange, sameLspRange, type PositionContext } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type Range, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

function quickFixes(context: PositionContext, document: TextDocument, module: ProjectModule | null, diagnostics: readonly unknown[]): unknown[] {
  if (!module) return [];
  const source = module.result.source;
  const registered = [...module.result.diagnostics, ...module.result.advisories]
    .filter((item) => item.fix && item.fix.edits.length > 0)
    .map((item) => ({ code: item.code, range: lspRange(context, source, boundedDiagnosticSpan(source, item.span)), fix: item.fix! }));
  if (registered.length === 0) return [];
  const actions: unknown[] = [];
  for (const value of diagnostics.slice(0, MAX_LSP_RESULT_ITEMS)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const diagnostic = value as { readonly code?: unknown; readonly range?: unknown };
    if (!diagnostic.range || typeof diagnostic.range !== "object" || Array.isArray(diagnostic.range)) continue;
    const range = diagnostic.range as Range;
    const match = registered.find((item) => item.code === diagnostic.code && sameLspRange(item.range, range));
    if (!match) continue;
    actions.push({
      title: match.fix.title,
      kind: "quickfix",
      isPreferred: true,
      edit: {
        changes: {
          [document.uri]: match.fix.edits.map((edit) => ({ range: lspRange(context, source, edit.span), newText: edit.text })),
        },
      },
    });
  }
  return actions;
}

export async function codeAction(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const context = params?.context as { readonly diagnostics?: readonly unknown[]; readonly only?: readonly string[] } | undefined;
  const document = session.documents.get(descriptor.uri);
  const acceptsQuickFix = !context?.only || context.only.some((kind) => kind === "quickfix" || kind.startsWith("quickfix."));
  const fixPath = pathOf(session, descriptor.uri);
  const fixProject = document && acceptsQuickFix ? await session.projectFor(document) : null;
  session.respond(message.id, document && acceptsQuickFix
    ? quickFixes(session, document, fixProject && fixPath ? fixProject.modules.find((item) => item.inputPath === fixPath) ?? null : null, context?.diagnostics ?? [])
    : []);
}
