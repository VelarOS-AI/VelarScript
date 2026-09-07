/** D115 P4 R4c — `velar/ownershipGraph`: the structure view, as a snapshot or a patch on one. */
import { pathToFileURL } from "node:url";
import {
  buildOwnershipGraph,
  ownershipGraphDelta,
  ownershipGraphRevision,
  updateOwnershipGraph,
  type OwnershipGraphDelta,
  type OwnershipGraphResult,
} from "../ownership-graph.ts";
import { VELAR_VERSION } from "../version.ts";
import { clipLspText } from "./diagnostics.ts";
import { isVelarDocument, projectRelativeGraphPath, withinWorkspaceRoot } from "./paths.ts";
import { lspRange, sourceFor } from "./positions.ts";
import {
  MAX_OWNERSHIP_GRAPH_EDGES,
  MAX_OWNERSHIP_GRAPH_NODES,
  type RequestParams,
  type TextDocument,
} from "./protocol.ts";
import type { DocumentRequestSession, OwnershipGraphEntry } from "./session.ts";
import { requestKey, type RpcMessage } from "./transport.ts";

/** The graph is cached per project root and bound pair, and rebuilt as a delta when it can be. */
export interface OwnershipGraphSession extends DocumentRequestSession {
  readonly ownershipGraphs: Map<string, OwnershipGraphEntry>;
  readonly cancelledRequests: ReadonlySet<string>;
}

export async function ownershipGraph(session: OwnershipGraphSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
  const requestedVersionValue = params?.version;
  const maximumNodesValue = params?.maximumNodes;
  const maximumEdgesValue = params?.maximumEdges;
  const previousRevisionValue = params?.previousRevision;
  if (!descriptor || typeof descriptor.uri !== "string"
    || (requestedVersionValue !== undefined && (typeof requestedVersionValue !== "number" || !Number.isSafeInteger(requestedVersionValue)))
    || (maximumNodesValue !== undefined && (typeof maximumNodesValue !== "number" || !Number.isSafeInteger(maximumNodesValue)))
    || (maximumEdgesValue !== undefined && (typeof maximumEdgesValue !== "number" || !Number.isSafeInteger(maximumEdgesValue)))
    || (previousRevisionValue !== undefined && (typeof previousRevisionValue !== "string" || !/^[a-f0-9]{64}$/u.test(previousRevisionValue)))) {
    session.respondError(message.id, "velar/ownershipGraph requires textDocument.uri and optional integer version, maximumNodes, maximumEdges, and 64-character previousRevision", -32602);
    return;
  }
  const requestedVersion = requestedVersionValue as number | undefined;
  const maximumNodes = maximumNodesValue as number | undefined;
  const maximumEdges = maximumEdgesValue as number | undefined;
  const previousRevision = previousRevisionValue as string | undefined;
  if ((maximumNodes !== undefined && (maximumNodes < 1 || maximumNodes > MAX_OWNERSHIP_GRAPH_NODES))
    || (maximumEdges !== undefined && (maximumEdges < 1 || maximumEdges > MAX_OWNERSHIP_GRAPH_EDGES))) {
    session.respondError(message.id, `velar/ownershipGraph bounds are 1..${MAX_OWNERSHIP_GRAPH_NODES} nodes and 1..${MAX_OWNERSHIP_GRAPH_EDGES} edges`, -32602);
    return;
  }
  const document = session.documents.get(descriptor.uri);
  if (!document || !isVelarDocument(document)) {
    session.respondError(message.id, "velar/ownershipGraph requires an open VelarScript document", -32602);
    return;
  }
  if (requestedVersion !== undefined && requestedVersion !== document.version) {
    session.respondError(message.id, `Document version ${requestedVersion} is no longer current`, -32801);
    return;
  }
  const project = await session.projectFor(document);
  if (!project) {
    session.respondError(message.id, "VelarScript project is unavailable for this document");
    return;
  }
  const graphKey = `${project.projectRoot}\0${maximumNodes ?? "default"}\0${maximumEdges ?? "default"}`;
  const cached = session.ownershipGraphs.get(graphKey);
  const currentRevision = ownershipGraphRevision(project);
  const graphOptions = {
    ...(maximumNodes === undefined ? {} : { maximumNodes }),
    ...(maximumEdges === undefined ? {} : { maximumEdges }),
    cancelled: () => message.id !== undefined && session.cancelledRequests.has(requestKey(message.id)),
  };
  let graph: OwnershipGraphResult;
  let latestDelta: OwnershipGraphDelta | null;
  if (cached?.graph.revision === currentRevision) {
    graph = cached.graph;
    latestDelta = cached.delta;
    if (cached.project !== project) session.ownershipGraphs.set(graphKey, { ...cached, project });
  } else {
    graph = cached
      ? await updateOwnershipGraph(cached.graph, cached.project, project, graphOptions)
      : await buildOwnershipGraph(project, graphOptions);
    latestDelta = cached ? ownershipGraphDelta(cached.graph, graph) : null;
    session.ownershipGraphs.set(graphKey, { graph, delta: latestDelta, project });
  }
  const patch = previousRevision === graph.revision
    ? ownershipGraphDelta(graph, graph)
    : latestDelta?.baseRevision === previousRevision
      ? latestDelta
      : null;
  const responseNodes = patch?.nodes ?? graph.nodes;
  const responseEdges = patch?.edges ?? graph.edges;
  session.respond(message.id, {
    protocolVersion: 1,
    mode: patch ? "patch" : "snapshot",
    ...(patch ? {
      baseRevision: patch.baseRevision,
      removedNodeIds: patch.removedNodeIds,
      removedEdgeIds: patch.removedEdgeIds,
    } : {}),
    rootUri: pathToFileURL(project.projectRoot).href,
    document: { uri: descriptor.uri, version: document.version },
    compilerVersion: VELAR_VERSION,
    revision: graph.revision,
    nodes: responseNodes.map((node) => {
      const sourcePath = node.path && withinWorkspaceRoot(project.projectRoot, node.path) ? node.path : null;
      return {
        id: node.id,
        kind: node.kind,
        name: clipLspText(node.name),
        ...(node.documentation ? { documentation: clipLspText(node.documentation) } : {}),
        ...(node.context ? { context: clipLspText(node.context) } : {}),
        ...(node.type ? { type: clipLspText(node.type) } : {}),
        ...(node.exported === undefined ? {} : { exported: node.exported }),
        ...(node.mutable === undefined ? {} : { mutable: node.mutable }),
        ...(sourcePath ? { path: projectRelativeGraphPath(project.projectRoot, sourcePath) } : {}),
        ...(sourcePath && node.span ? { uri: pathToFileURL(sourcePath).href, range: lspRange(session, sourceFor(project, sourcePath), node.span) } : {}),
        ...(sourcePath && node.selectionSpan ? { selectionRange: lspRange(session, sourceFor(project, sourcePath), node.selectionSpan) } : {}),
      };
    }),
    edges: responseEdges.map((edge) => {
      const sourcePath = edge.path && withinWorkspaceRoot(project.projectRoot, edge.path) ? edge.path : null;
      return {
        id: edge.id,
        kind: edge.kind,
        from: edge.from,
        to: edge.to,
        ...(sourcePath ? { path: projectRelativeGraphPath(project.projectRoot, sourcePath) } : {}),
        ...(sourcePath && edge.span ? { uri: pathToFileURL(sourcePath).href, range: lspRange(session, sourceFor(project, sourcePath), edge.span) } : {}),
      };
    }),
    coverage: graph.coverage,
    limitReached: graph.limitReached,
    durationMs: graph.durationMs,
    activity: graph.activity,
  });
}
