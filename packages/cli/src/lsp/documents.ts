/** D115 P4 R4c — the document notifications, and the watcher batch that reindexes a workspace. */
import type { VelarProjectSessions } from "../project-session.ts";
import {
  MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
  MAX_WORKSPACE_CHANGE_PATHS,
  MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
  type WorkspaceIndexActivity,
  type WorkspaceTextIndex,
} from "../workspace-index.ts";
import { publish, schedulePublish, type DiagnosticsSession } from "./diagnostics.ts";
import { authorizedPathOf, isVelarDocument, pathOf, rawPathOf } from "./paths.ts";
import { applyContentChanges } from "./positions.ts";
import type { ContentChange, RequestParams, TextDocument } from "./protocol.ts";
import { mapBounded, type RpcMessage } from "./transport.ts";

/** Document sync owns the document table, so it needs the mutable map rather than a read-only view. */
export interface DocumentSyncSession extends DiagnosticsSession {
  readonly documents: Map<string, TextDocument>;
  readonly sessions: VelarProjectSessions;
  readonly workspaceIndex: WorkspaceTextIndex;
  readonly overrides: () => Map<string, string>;
  readonly queueWorkspaceIndex: (operation: () => Promise<WorkspaceIndexActivity>) => Promise<WorkspaceIndexActivity>;
  readonly refreshWorkspaceProjects: (changedPaths: ReadonlySet<string> | null) => Promise<void>;
}

export async function didOpen(session: DocumentSyncSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const value = params?.textDocument as TextDocument;
  const path = await authorizedPathOf(session, value.uri);
  if ((session.confinedWorkspaceRoot || session.confinedCanonicalRoot) && !path) {
    session.send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Ignored a document outside the Desktop project grant" } });
    return;
  }
  session.documents.set(value.uri, value);
  if (path) session.workspaceIndex.openDocument(path, value.text);
  if (path && isVelarDocument(value)) {
    try { await session.sessions.snapshot(path, session.overrides()); }
    catch { /* publish converts project/config failures into document diagnostics. */ }
  }
  await publish(session, value);
}

export function didChange(session: DocumentSyncSession, message: RpcMessage, params: RequestParams): void {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri" | "version">;
  const current = session.documents.get(descriptor.uri);
  if (!current || !Number.isSafeInteger(descriptor.version) || descriptor.version <= current.version) return;
  const changes = params?.contentChanges as readonly ContentChange[];
  if (!Array.isArray(changes)) return;
  const next = { ...current, version: descriptor.version, text: applyContentChanges(session, current.text, changes) };
  session.documents.set(next.uri, next);
  const nextPath = pathOf(session, next.uri);
  if (nextPath) session.workspaceIndex.changeDocument(nextPath, next.text);
  schedulePublish(session, next.uri);
}

export function didSave(session: DocumentSyncSession, message: RpcMessage, params: RequestParams): void {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const current = session.documents.get(descriptor.uri);
  if (current) schedulePublish(session, current.uri);
}

export async function didClose(session: DocumentSyncSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const current = session.documents.get(descriptor.uri);
  session.documents.delete(descriptor.uri);
  session.diagnosticUris.delete(descriptor.uri);
  const path = pathOf(session, descriptor.uri);
  if (path) await session.queueWorkspaceIndex(() => session.workspaceIndex.closeDocument(path));
  if (path && current && isVelarDocument(current)) await session.sessions.update(path, new Set([path]), session.overrides());
  session.send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: descriptor.uri, diagnostics: [] } });
}

export async function didChangeWatchedFiles(session: DocumentSyncSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const changes = params?.changes as readonly { readonly uri?: unknown }[] | undefined;
  if (!Array.isArray(changes)) return;
  let fidelityLost = changes.length > MAX_WORKSPACE_CHANGE_PATHS;
  let pathUnits = 0;
  const urisByPath = new Map<string, string>();
  if (!fidelityLost) {
    for (const change of changes) {
      const uri = change?.uri;
      if (typeof uri !== "string" || uri.length > MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS * 3 + 32) {
        fidelityLost = true;
        break;
      }
      const rawPath = rawPathOf(uri);
      if (!rawPath || rawPath.length > MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS) {
        fidelityLost = true;
        break;
      }
      if (!urisByPath.has(rawPath)) {
        pathUnits += rawPath.length;
        if (pathUnits > MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS) {
          fidelityLost = true;
          break;
        }
        urisByPath.set(rawPath, uri);
      }
    }
  }
  if (fidelityLost) {
    session.send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Watcher batch exceeded the official bounds; rebuilt the initialized workspace index" } });
    await session.queueWorkspaceIndex(() => session.workspaceIndex.rescan());
    await session.refreshWorkspaceProjects(null);
    return;
  }
  const changedPaths = new Set<string>();
  const uris = [...urisByPath.values()];
  const authorizedPaths = await mapBounded(uris, 16, (uri) => authorizedPathOf(session, uri));
  for (let index = 0; index < uris.length; index += 1) {
    const path = authorizedPaths[index];
    if (path) changedPaths.add(path);
    else if (session.confinedWorkspaceRoot || session.confinedCanonicalRoot) {
      session.send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Ignored a watcher path outside the Desktop project grant" } });
    }
  }
  if (changedPaths.size === 0) return;
  await session.queueWorkspaceIndex(() => session.workspaceIndex.update(changedPaths));
  await session.refreshWorkspaceProjects(changedPaths);
}
