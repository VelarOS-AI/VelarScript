/** D115 P4 R4c — `velar/workspaceRescan`, `velar/workspaceSearch`, and `workspace/symbol`. */
import { pathToFileURL } from "node:url";
import { projectWorkspaceSymbols } from "../project-semantic.ts";
import type { VelarProjectSessions } from "../project-session.ts";
import type { ProjectResult } from "../project.ts";
import {
  MAX_WORKSPACE_SEARCH_RESULTS,
  WorkspaceIndexCancelledError,
  type WorkspaceIndexActivity,
  type WorkspaceTextIndex,
} from "../workspace-index.ts";
import { clipLspText } from "./diagnostics.ts";
import { lspSymbolKind } from "./kinds.ts";
import { isVelarDocument, pathOf } from "./paths.ts";
import { lspLocation, workspacePosition } from "./positions.ts";
import { MAX_LSP_RESULT_ITEMS, type RequestParams } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import { requestKey, type RpcMessage } from "./transport.ts";

/** Workspace-wide answers wait on the text index and may be cancelled while they scan. */
export interface WorkspaceSession extends DocumentRequestSession {
  readonly sessions: VelarProjectSessions;
  readonly workspaceIndex: WorkspaceTextIndex;
  readonly cancelledRequests: ReadonlySet<string>;
  readonly overrides: () => Map<string, string>;
  readonly queueWorkspaceIndex: (operation: () => Promise<WorkspaceIndexActivity>) => Promise<WorkspaceIndexActivity>;
  readonly waitForWorkspaceIndex: (id: RpcMessage["id"]) => Promise<void>;
  readonly refreshWorkspaceProjects: (changedPaths: ReadonlySet<string> | null) => Promise<void>;
}

export async function workspaceRescan(session: WorkspaceSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const activity = await session.queueWorkspaceIndex(() => session.workspaceIndex.rescan(
    () => message.id !== undefined && session.cancelledRequests.has(requestKey(message.id)),
  ));
  await session.refreshWorkspaceProjects(null);
  if (message.id !== undefined) session.respond(message.id, activity);
}

export async function workspaceSearch(session: WorkspaceSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const query = params?.query;
  const caseSensitive = params?.caseSensitive;
  const maximumResults = params?.maximumResults;
  if (typeof query !== "string"
    || (caseSensitive !== undefined && typeof caseSensitive !== "boolean")
    || (maximumResults !== undefined && typeof maximumResults !== "number")) {
    session.respondError(message.id, "velar/workspaceSearch requires a string query and optional boolean caseSensitive and numeric maximumResults", -32602);
    return;
  }
  if (query.length === 0 || query.length > 1_024
    || (maximumResults !== undefined && (!Number.isSafeInteger(maximumResults)
      || maximumResults < 1 || maximumResults > MAX_WORKSPACE_SEARCH_RESULTS))) {
    session.respondError(message.id, `velar/workspaceSearch query must contain 1 through 1024 UTF-16 code units and maximumResults must be an integer from 1 through ${MAX_WORKSPACE_SEARCH_RESULTS}`, -32602);
    return;
  }
  await session.waitForWorkspaceIndex(message.id);
  const result = await session.workspaceIndex.search(query, {
    ...(caseSensitive === undefined ? {} : { caseSensitive }),
    ...(maximumResults === undefined ? {} : { maximumResults }),
    cancelled: () => message.id !== undefined && session.cancelledRequests.has(requestKey(message.id)),
  });
  session.respond(message.id, {
    items: result.matches.map((match) => ({
      uri: pathToFileURL(match.path).href,
      range: {
        start: workspacePosition(session, match.start),
        end: workspacePosition(session, match.end),
      },
      preview: match.preview,
    })),
    limitReached: result.limitReached,
    filesSearched: result.filesSearched,
    indexedFiles: result.indexedFiles,
    indexedBytes: result.indexedBytes,
    revision: result.revision,
    durationMs: result.durationMs,
    coverageComplete: result.coverageComplete,
  });
}

export async function workspaceSymbol(session: WorkspaceSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const query = params?.query;
  if (typeof query !== "string") {
    session.respondError(message.id, "workspace/symbol requires a string query", -32602);
    return;
  }
  if (query.length > 1_024) {
    session.respondError(message.id, "workspace/symbol query cannot exceed 1024 UTF-16 code units", -32602);
    return;
  }
  await session.waitForWorkspaceIndex(message.id);
  const projects = new Map<string, ProjectResult>();
  for (const document of session.documents.values()) {
    if (!isVelarDocument(document)) continue;
    const path = pathOf(session, document.uri);
    if (!path) continue;
    try {
      const snapshot = await session.sessions.update(path, new Set(), session.overrides());
      projects.set(snapshot.config.root, snapshot.project);
    } catch {
      // Invalid projects already own document diagnostics and cannot poison symbols from healthy workspace roots.
    }
  }
  let indexedVelarPaths = 0;
  for (const path of session.workspaceIndex.paths(".vel")) {
    if (message.id !== undefined && session.cancelledRequests.has(requestKey(message.id))) throw new WorkspaceIndexCancelledError();
    indexedVelarPaths += 1;
    if (indexedVelarPaths % 128 === 0) await new Promise<void>((resolveYield) => setImmediate(resolveYield));
    try {
      const snapshot = await session.sessions.update(path, new Set(), session.overrides());
      projects.set(snapshot.config.root, snapshot.project);
      if (projects.size > 64) throw new RangeError("workspace/symbol cannot span more than 64 VelarScript project roots");
    } catch (error) {
      if (error instanceof RangeError && /more than 64 VelarScript project roots/u.test(error.message)) throw error;
      // Broken project roots retain their document diagnostics and do not suppress symbols from healthy roots.
    }
  }
  const symbols: unknown[] = [];
  for (const project of projects.values()) {
    const remaining = MAX_LSP_RESULT_ITEMS - symbols.length;
    if (remaining === 0) break;
    symbols.push(...projectWorkspaceSymbols(project, query, remaining).map((symbol) => ({
        name: clipLspText(symbol.name),
        kind: lspSymbolKind(symbol.presentationKind ?? symbol.kind),
        location: lspLocation(session, project, symbol.path, symbol.selectionSpan),
        ...(symbol.containerName ? { containerName: clipLspText(symbol.containerName) } : {}),
      })));
  }
  session.respond(message.id, symbols);
}
