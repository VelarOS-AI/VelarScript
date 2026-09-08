/** `velar graph`: the compiler-owned project logic graph, for people and tools. */

import { resolve } from "node:path";
import { MAXIMUM_GRAPH_SOURCE_EDGES, MAXIMUM_GRAPH_SOURCE_NODES, parseGraphArguments } from "../arguments.ts";
import { resolveVelarProject } from "../config.ts";
import { hostErrorMessage } from "../host-error.ts";
import { createProjectLogicGraph, projectLogicGraphSources, renderProjectLogicGraph } from "../logic-graph-output.ts";
import { buildOwnershipGraph } from "../ownership-graph.ts";
import { VelarProjectSessions } from "../project-session.ts";

export async function runGraphCommand(rest: readonly string[]): Promise<number> {
  const parsed = parseGraphArguments(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`velar graph: ${parsed}\n`);
    return 2;
  }
  try {
    const config = await resolveVelarProject(parsed.input);
    const documentPath = parsed.input?.endsWith(".vel") ? resolve(parsed.input) : config.entryPath;
    const snapshot = await new VelarProjectSessions().snapshot(documentPath);
    const graph = await buildOwnershipGraph(snapshot.project, {
      maximumNodes: MAXIMUM_GRAPH_SOURCE_NODES,
      maximumEdges: MAXIMUM_GRAPH_SOURCE_EDGES,
    });
    const diagnostics = snapshot.project.failures.length
      + snapshot.project.modules.reduce((count, module) => count + module.result.diagnostics.length, 0);
    const view = createProjectLogicGraph(graph, snapshot.config.root, {
      ...(parsed.focus ? { focus: parsed.focus } : {}),
      depth: parsed.depth,
      maximumNodes: parsed.maximumNodes,
      maximumEdges: parsed.maximumEdges,
      diagnostics,
    });
    // GA-U7: the human form reads `file:line:column`, the shape every other
    // location this toolchain prints has; `--json` keeps the byte offsets a
    // tool splices with.
    process.stdout.write(parsed.json
      ? `${JSON.stringify(view, null, 2)}\n`
      : renderProjectLogicGraph(view, projectLogicGraphSources(snapshot.project, snapshot.config.root)));
    return 0;
  } catch (error) {
    process.stderr.write(`velar graph: ${hostErrorMessage(error)}\n`);
    return 1;
  }
}
