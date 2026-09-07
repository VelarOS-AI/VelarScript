/**
 * D115 P4 R4c — one running language server's state, and the closures that read it.
 *
 * `runLanguageServer` used to hold this as 24 locals and twelve nested arrow
 * functions, which is why nothing else could see them. They are a record now,
 * and a capability module says which part of it it needs rather than naming the
 * whole thing. Three fields were module-level mutable state before the split —
 * the negotiated position encoding and the two halves of the Desktop project
 * grant — and reading them off the session is what lets `positions.ts` and
 * `paths.ts` be ordinary pure modules.
 */
import { canonicalizePotentialPath } from "../canonical-path.ts";
import { hostErrorMessage } from "../host-error.ts";
import type { OwnershipGraphDelta, OwnershipGraphResult } from "../ownership-graph.ts";
import { VelarProjectSessions, type ProjectSessionSnapshot } from "../project-session.ts";
import type { ProjectResult } from "../project.ts";
import {
  WorkspaceIndexCancelledError,
  WorkspaceTextIndex,
  type WorkspaceIndexActivity,
} from "../workspace-index.ts";
import { schedulePublish } from "./diagnostics.ts";
import {
  configuredCanonicalRoot,
  configuredWorkspaceRoot,
  isVelarDocument,
  pathOf,
  type WorkspaceConfinement,
} from "./paths.ts";
import type { PositionContext, PositionEncoding } from "./positions.ts";
import type { TextDocument } from "./protocol.ts";
import { requestKey, send, type RespondErrorFn, type RespondFn, type RpcMessage } from "./transport.ts";

/** One cached ownership graph, the project it was built from, and the delta that produced it. */
export interface OwnershipGraphEntry {
  readonly graph: OwnershipGraphResult;
  readonly delta: OwnershipGraphDelta | null;
  readonly project: ProjectResult;
}

/**
 * What a request that answers from one open document reads: the document table,
 * the project behind it, and the two ways to answer.
 */
export interface DocumentRequestSession extends PositionContext, WorkspaceConfinement {
  readonly documents: ReadonlyMap<string, TextDocument>;
  readonly projectFor: (document: TextDocument) => Promise<ProjectResult | null>;
  readonly respond: RespondFn;
  readonly respondError: RespondErrorFn;
}

/** Everything one running server owns. Each capability takes the narrowest view of it that answers. */
export interface LanguageServerSession {
  positionEncoding: PositionEncoding;
  readonly confinedWorkspaceRoot: string | null;
  readonly confinedCanonicalRoot: string | null;
  readonly documents: Map<string, TextDocument>;
  readonly sessions: VelarProjectSessions;
  readonly ownershipGraphs: Map<string, OwnershipGraphEntry>;
  readonly workspaceIndex: WorkspaceTextIndex;
  readonly pendingRequests: Set<string>;
  readonly cancelledRequests: Set<string>;
  readonly diagnosticUris: Set<string>;
  buffer: Buffer;
  queue: Promise<void>;
  diagnosticTask: Promise<void> | null;
  shuttingDown: boolean;
  readonly finish: () => void;
  readonly exitRequested: Promise<void>;
  readonly send: (message: unknown) => void;
  readonly overrides: () => Map<string, string>;
  readonly projectSnapshotFor: (document: TextDocument) => Promise<ProjectSessionSnapshot | null>;
  readonly projectFor: (document: TextDocument) => Promise<ProjectResult | null>;
  readonly queueWorkspaceIndex: (operation: () => Promise<WorkspaceIndexActivity>) => Promise<WorkspaceIndexActivity>;
  readonly waitForWorkspaceIndex: (id: RpcMessage["id"]) => Promise<void>;
  readonly refreshWorkspaceProjects: (changedPaths: ReadonlySet<string> | null) => Promise<void>;
  readonly finishRequest: (id: RpcMessage["id"]) => boolean;
  readonly respond: RespondFn;
  readonly respondError: RespondErrorFn;
}

export async function createSession(): Promise<LanguageServerSession> {
  const confinedWorkspaceRoot = configuredWorkspaceRoot();
  const configuredCanonical = configuredCanonicalRoot() ?? confinedWorkspaceRoot;
  const confinedCanonicalRoot = configuredCanonical ? await canonicalizePotentialPath(configuredCanonical) : null;
  const documents = new Map<string, TextDocument>();
  const sessions = new VelarProjectSessions();
  const pendingRequests = new Set<string>();
  const cancelledRequests = new Set<string>();
  let finish: () => void = () => {};
  const exitRequested = new Promise<void>((resolve) => { finish = resolve; });
  const { queueWorkspaceIndex, waitForWorkspaceIndex } = workspaceIndexQueue(cancelledRequests);

  const overrides = (): Map<string, string> => new Map([...documents.values()].flatMap((item) => {
    if (!isVelarDocument(item)) return [];
    const itemPath = pathOf(session, item.uri);
    return itemPath ? [[itemPath, item.text] as const] : [];
  }));
  const projectSnapshotFor = async (document: TextDocument): Promise<ProjectSessionSnapshot | null> => {
    if (!isVelarDocument(document)) return null;
    const path = pathOf(session, document.uri);
    if (!path) return null;
    return sessions.update(path, new Set(), overrides());
  };
  const projectFor = async (document: TextDocument): Promise<ProjectResult | null> =>
    (await projectSnapshotFor(document))?.project ?? null;
  const refreshWorkspaceProjects = async (changedPaths: ReadonlySet<string> | null): Promise<void> => {
    const currentOverrides = overrides();
    const roots = new Map<string, string>();
    for (const document of documents.values()) {
      if (!isVelarDocument(document)) continue;
      const documentPath = pathOf(session, document.uri);
      if (!documentPath) continue;
      roots.set(sessions.rootFor(documentPath) ?? documentPath, documentPath);
    }
    for (const documentPath of roots.values()) {
      if (changedPaths) await sessions.update(documentPath, changedPaths, currentOverrides);
      else await sessions.snapshot(documentPath, currentOverrides);
    }
    for (const document of documents.values()) schedulePublish(session, document.uri);
  };
  const finishRequest = (id: RpcMessage["id"]): boolean => {
    if (id === undefined) return false;
    const key = requestKey(id);
    pendingRequests.delete(key);
    return cancelledRequests.delete(key);
  };
  const respond = (id: RpcMessage["id"], result: unknown): void => {
    if (finishRequest(id)) {
      send({ jsonrpc: "2.0", id: id ?? null, error: { code: -32800, message: "Request cancelled" } });
      return;
    }
    send({ jsonrpc: "2.0", id: id ?? null, result });
  };
  const respondError = (id: RpcMessage["id"], message: string, code = -32803): void => {
    if (finishRequest(id)) {
      send({ jsonrpc: "2.0", id: id ?? null, error: { code: -32800, message: "Request cancelled" } });
      return;
    }
    send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  };

  const session: LanguageServerSession = {
    positionEncoding: "utf-16",
    confinedWorkspaceRoot,
    confinedCanonicalRoot,
    documents,
    sessions,
    ownershipGraphs: new Map<string, OwnershipGraphEntry>(),
    workspaceIndex: new WorkspaceTextIndex(),
    pendingRequests,
    cancelledRequests,
    diagnosticUris: new Set<string>(),
    buffer: Buffer.alloc(0),
    queue: Promise.resolve(),
    diagnosticTask: null,
    shuttingDown: false,
    finish,
    exitRequested,
    send,
    overrides,
    projectSnapshotFor,
    projectFor,
    queueWorkspaceIndex,
    waitForWorkspaceIndex,
    refreshWorkspaceProjects,
    finishRequest,
    respond,
    respondError,
  };
  return session;
}

/**
 * The workspace text index is rebuilt on one serialized task; a search waits for
 * whatever is in flight, and a failure is retained so the next explicit request
 * reports it rather than a stale answer.
 */
function workspaceIndexQueue(cancelledRequests: ReadonlySet<string>): {
  readonly queueWorkspaceIndex: (operation: () => Promise<WorkspaceIndexActivity>) => Promise<WorkspaceIndexActivity>;
  readonly waitForWorkspaceIndex: (id: RpcMessage["id"]) => Promise<void>;
} {
  let workspaceIndexTask: Promise<void> = Promise.resolve();
  let workspaceIndexFailure: string | null = null;
  const queueWorkspaceIndex = (operation: () => Promise<WorkspaceIndexActivity>): Promise<WorkspaceIndexActivity> => {
    const result = workspaceIndexTask.then(operation);
    workspaceIndexTask = result.then(
      () => { workspaceIndexFailure = null; },
      (error) => { workspaceIndexFailure = hostErrorMessage(error); },
    );
    return result;
  };
  const waitForWorkspaceIndex = async (id: RpcMessage["id"]): Promise<void> => {
    while (true) {
      if (id !== undefined && cancelledRequests.has(requestKey(id))) throw new WorkspaceIndexCancelledError();
      const task = workspaceIndexTask;
      let settled = false;
      await Promise.race([
        task.then(() => { settled = true; }),
        new Promise<void>((resolveWait) => setImmediate(resolveWait)),
      ]);
      if (settled && task === workspaceIndexTask) break;
    }
    if (workspaceIndexFailure) throw new Error(`Workspace index unavailable: ${workspaceIndexFailure}`);
  };
  return { queueWorkspaceIndex, waitForWorkspaceIndex };
}
