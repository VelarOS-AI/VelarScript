/** D115 P4 R4c — `initialize`, `initialized`, `shutdown`, `exit`: what the server promises and how it stops. */
import { hostErrorMessage } from "../host-error.ts";
import { VELAR_VERSION } from "../version.ts";
import {
  MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
  MAX_WORKSPACE_CHANGE_PATHS,
  MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
  MAX_WORKSPACE_SEARCH_RESULTS,
  MAX_WORKSPACE_TEXT_FILES,
  WORKSPACE_TEXT_EXTENSIONS,
  type WorkspaceIndexActivity,
  type WorkspaceTextIndex,
} from "../workspace-index.ts";
import { requestedWorkspaceRoots, type WorkspaceConfinement } from "./paths.ts";
import { requestedPositionEncoding, type PositionEncoding } from "./positions.ts";
import {
  MAX_EMITTED_JAVASCRIPT_CHARS,
  MAX_OWNERSHIP_GRAPH_EDGES,
  MAX_OWNERSHIP_GRAPH_NODES,
  semanticTokenModifiers,
  semanticTokenTypes,
  VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION,
  type RequestParams,
} from "./protocol.ts";
import type { RespondErrorFn, RespondFn, RpcMessage } from "./transport.ts";

/** The two session fields that change after the server starts are both owned here. */
export interface LifecycleSession extends WorkspaceConfinement {
  positionEncoding: PositionEncoding;
  shuttingDown: boolean;
  readonly workspaceIndex: WorkspaceTextIndex;
  readonly queueWorkspaceIndex: (operation: () => Promise<WorkspaceIndexActivity>) => Promise<WorkspaceIndexActivity>;
  readonly finish: () => void;
  readonly respond: RespondFn;
  readonly respondError: RespondErrorFn;
}

export function initialize(session: LifecycleSession, message: RpcMessage, params: RequestParams): void {
  session.positionEncoding = requestedPositionEncoding(params);
  try {
    session.workspaceIndex.configure(requestedWorkspaceRoots(session, params));
  } catch (error) {
    session.respondError(message.id, hostErrorMessage(error), -32602);
    return;
  }
  session.respond(message.id, {
    capabilities: {
      positionEncoding: session.positionEncoding,
      textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
      completionProvider: { triggerCharacters: [".", "<", " ", "{", ",", ":"] },
      hoverProvider: true,
      documentFormattingProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      signatureHelpProvider: { triggerCharacters: ["(", ","] },
      inlayHintProvider: true,
      semanticTokensProvider: {
        legend: { tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers },
        full: true,
      },
      codeActionProvider: { codeActionKinds: ["quickfix"] },
      experimental: {
        velar: {
          protocolVersion: VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION,
          incrementalSessions: true,
          watchedFiles: true,
          workspaceRescan: true,
          cancellation: true,
          workspaceSearch: true,
          workspaceTextExtensions: WORKSPACE_TEXT_EXTENSIONS,
          workspaceTextFileLimit: MAX_WORKSPACE_TEXT_FILES,
          workspaceSearchResultLimit: MAX_WORKSPACE_SEARCH_RESULTS,
          workspaceWatchPathLimit: MAX_WORKSPACE_CHANGE_PATHS,
          workspaceWatchPathCodeUnitLimit: MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
          workspaceWatchTextCodeUnitLimit: MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
          ownershipGraph: true,
          ownershipGraphPatches: true,
          ownershipGraphAffectedModules: true,
          ownershipGraphNodeLimit: MAX_OWNERSHIP_GRAPH_NODES,
          ownershipGraphEdgeLimit: MAX_OWNERSHIP_GRAPH_EDGES,
          emittedJavaScript: true,
          emittedJavaScriptCodeUnitLimit: MAX_EMITTED_JAVASCRIPT_CHARS,
        },
      },
    },
    serverInfo: { name: "VelarScript Language Server", version: VELAR_VERSION },
  });
}

export function initialized(session: LifecycleSession): void {
  void session.queueWorkspaceIndex(() => session.workspaceIndex.rescan()).catch(() => {
    // The next explicit search reports the retained indexing failure through its request response.
  });
}

export function shutdown(session: LifecycleSession, message: RpcMessage): void {
  session.shuttingDown = true;
  session.respond(message.id, null);
}

export function exit(session: LifecycleSession): void {
  process.exitCode = session.shuttingDown ? 0 : 1;
  process.stdin.pause();
  session.finish();
}
