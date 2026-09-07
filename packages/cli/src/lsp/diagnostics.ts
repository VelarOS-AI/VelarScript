/**
 * D115 P4 R4c — what the server publishes on the diagnostic channel, and the
 * bounds it publishes within.
 *
 * This module does not import the transport: `send` reaches it as a session
 * field, so `transport.ts` can import the oversize fallback from here without
 * the two importing each other.
 */
import { compile, type Advisory, type Diagnostic, type SourceText, type Span } from "@velarscript/compiler";
import { hostErrorMessage } from "../host-error.ts";
import type { ProjectSessionSnapshot } from "../project-session.ts";
import { projectSessionDiagnostics } from "../project-session-diagnostics.ts";
import { isVelarDocument, pathOf, type WorkspaceConfinement } from "./paths.ts";
import { lspSourcePosition, type PositionContext } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, MAX_LSP_TEXT_CHARS, type TextDocument } from "./protocol.ts";

/** What publishing needs from the session. */
export interface DiagnosticsSession extends PositionContext, WorkspaceConfinement {
  readonly documents: ReadonlyMap<string, TextDocument>;
  readonly diagnosticUris: Set<string>;
  diagnosticTask: Promise<void> | null;
  readonly send: (message: unknown) => void;
  readonly projectSnapshotFor: (document: TextDocument) => Promise<ProjectSessionSnapshot | null>;
}

export async function publish(session: DiagnosticsSession, document: TextDocument): Promise<void> {
  const current = session.documents.get(document.uri);
  if (!current || current.version !== document.version) return;
  if (!isVelarDocument(document)) {
    session.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: document.uri, version: document.version, diagnostics: [] },
    });
    return;
  }
  let diagnostics: readonly Diagnostic[] = [];
  let advisories: readonly Advisory[] = [];
  let notices: readonly string[] = [];
  let source: SourceText;
  try {
    const path = pathOf(session, document.uri);
    if (path) {
      const snapshot = await session.projectSnapshotFor(document);
      const project = snapshot?.project ?? null;
      const module = project?.modules.find((item) => item.inputPath === path);
      if (module) {
        diagnostics = projectSessionDiagnostics(snapshot!, path);
        advisories = module.result.advisories;
        notices = (project?.notices ?? []).filter((notice) => notice.path === path).map((notice) => notice.message);
        source = module.result.source;
      } else {
        const result = compile(document.text, { path });
        diagnostics = result.diagnostics;
        advisories = result.advisories;
        source = result.source;
      }
    } else {
      const result = compile(document.text, { path: document.uri });
      diagnostics = result.diagnostics;
      advisories = result.advisories;
      source = result.source;
    }
  } catch (error) {
    const result = compile(document.text, { path: document.uri });
    diagnostics = [{ code: "VEL9001", message: hostErrorMessage(error), span: { start: 0, end: 1 } }];
    advisories = [];
    source = result.source;
  }
  if (session.documents.get(document.uri)?.version !== document.version) return;
  session.send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: document.uri,
      version: document.version,
      diagnostics: boundedDiagnostics(session, source, diagnostics, notices, advisories),
    },
  });
}

export function schedulePublish(session: DiagnosticsSession, uri: string): void {
  session.diagnosticUris.add(uri);
  if (session.diagnosticTask) return;
  session.diagnosticTask = new Promise<void>((resolve) => setImmediate(resolve))
    .then(async () => {
      while (session.diagnosticUris.size > 0) {
        const uris = [...session.diagnosticUris];
        session.diagnosticUris.clear();
        for (const pendingUri of uris) {
          const document = session.documents.get(pendingUri);
          if (document) await publish(session, document);
        }
      }
    })
    .finally(() => {
      session.diagnosticTask = null;
      if (session.diagnosticUris.size > 0) schedulePublish(session, [...session.diagnosticUris][0]!);
    });
}

export function clipLspText(value: string): string {
  return value.length <= MAX_LSP_TEXT_CHARS ? value : `${value.slice(0, MAX_LSP_TEXT_CHARS - 1)}…`;
}

export function boundedDiagnostics(
  context: PositionContext,
  source: SourceText,
  diagnostics: readonly Diagnostic[],
  notices: readonly string[],
  advisories: readonly Advisory[],
): unknown[] {
  const output: unknown[] = [];
  for (const diagnostic of diagnostics) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) break;
    output.push(lspDiagnostic(context, source, diagnostic));
  }
  // D89: advisories are published on the same channel the protocol gives an
  // editor, one severity below an error, so the squiggle a reader sees says
  // "this spelling means something else" without claiming the file failed.
  for (const item of advisories) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) break;
    output.push(lspAdvisory(context, source, item));
  }
  for (const notice of notices) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) break;
    output.push(lspNotice(context, source, notice));
  }
  if (diagnostics.length + advisories.length + notices.length > MAX_LSP_RESULT_ITEMS) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) output.pop();
    output.push(lspNotice(context, source, `Diagnostics were truncated to ${MAX_LSP_RESULT_ITEMS} items`));
  }
  return output;
}

export function oversizedDiagnosticsFallback(params: unknown): unknown {
  const input = params && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
  return {
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: typeof input.uri === "string" ? input.uri : "",
      ...(Number.isSafeInteger(input.version) ? { version: input.version } : {}),
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "VEL9003",
        source: "velar",
        message: "VelarScript diagnostics exceeded the 16 MiB LSP transport limit",
      }],
    },
  };
}

function lspDiagnostic(context: PositionContext, source: SourceText, item: Diagnostic): unknown {
  const start = lspSourcePosition(context, source, item.span.start);
  const end = lspSourcePosition(context, source, Math.max(item.span.start + 1, item.span.end));
  return {
    range: {
      start,
      end,
    },
    severity: 1,
    code: item.code,
    source: "velar",
    message: clipLspText(item.message),
  };
}

/** D89: severity 2 is Warning — an advisory is reported, never a failure. */
function lspAdvisory(context: PositionContext, source: SourceText, item: Advisory): unknown {
  const start = lspSourcePosition(context, source, item.span.start);
  const end = lspSourcePosition(context, source, Math.max(item.span.start + 1, item.span.end));
  return {
    range: {
      start,
      end,
    },
    severity: 2,
    code: item.code,
    source: "velar",
    message: clipLspText(item.message),
  };
}

function lspNotice(context: PositionContext, source: SourceText, message: string): unknown {
  const start = lspSourcePosition(context, source, 0);
  const end = lspSourcePosition(context, source, Math.min(1, source.text.length));
  return {
    range: {
      start,
      end,
    },
    severity: 3,
    code: "VEL9002",
    source: "velar",
    message: clipLspText(message),
  };
}

export function boundedDiagnosticSpan(source: SourceText, span: Span): Span {
  return { start: span.start, end: Math.max(span.start + 1, span.end) > source.text.length ? span.end : Math.max(span.start + 1, span.end) };
}
