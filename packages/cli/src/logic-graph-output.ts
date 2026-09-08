import { relative } from "node:path";
import type { SourceText } from "@velarscript/compiler";
import type {
  OwnershipGraphEdge,
  OwnershipGraphNode,
  OwnershipGraphResult,
} from "./ownership-graph.ts";
import type { ProjectResult } from "./project.ts";

export interface ProjectLogicGraphOptions {
  readonly focus?: string;
  readonly depth: number;
  readonly maximumNodes: number;
  readonly maximumEdges: number;
  readonly diagnostics: number;
}

export interface ProjectLogicGraphNode extends Omit<OwnershipGraphNode, "path"> {
  readonly path?: string;
}

export interface ProjectLogicGraphEdge extends Omit<OwnershipGraphEdge, "path"> {
  readonly path?: string;
}

export interface ProjectLogicGraphView {
  readonly protocolVersion: 1;
  readonly revision: string;
  readonly root: string;
  readonly focus: string | null;
  readonly depth: number;
  readonly diagnostics: number;
  readonly nodes: readonly ProjectLogicGraphNode[];
  readonly edges: readonly ProjectLogicGraphEdge[];
  readonly coverage: OwnershipGraphResult["coverage"];
  readonly sourceLimitReached: boolean;
  readonly selectionLimitReached: boolean;
}

const overviewKinds = new Set<OwnershipGraphNode["kind"]>([
  "module",
  "component",
  "state",
  "computed",
  "action",
  "function",
  "class",
  "type",
  "enum",
  "capability",
  "readonlyProjection",
]);

function portablePath(root: string, path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const value = relative(root, path).replaceAll("\\", "/");
  return value && !value.startsWith("../") ? value : path.replaceAll("\\", "/");
}

function focusNodes(nodes: readonly OwnershipGraphNode[], root: string, query: string): readonly OwnershipGraphNode[] {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  const exact = nodes.filter((node) => node.id.toLocaleLowerCase("en-US") === normalized
    || node.name.toLocaleLowerCase("en-US") === normalized
    || portablePath(root, node.path)?.toLocaleLowerCase("en-US") === normalized
    || node.context?.toLocaleLowerCase("en-US") === normalized);
  if (exact.length > 0) return exact;
  return nodes.filter((node) => node.name.toLocaleLowerCase("en-US").includes(normalized)
    || node.id.toLocaleLowerCase("en-US").includes(normalized)
    || portablePath(root, node.path)?.toLocaleLowerCase("en-US").includes(normalized)
    || node.context?.toLocaleLowerCase("en-US").includes(normalized));
}

export function createProjectLogicGraph(
  graph: OwnershipGraphResult,
  root: string,
  options: ProjectLogicGraphOptions,
): ProjectLogicGraphView {
  const selected = new Set<string>();
  let selectionLimitReached = false;
  if (options.focus) {
    const starts = focusNodes(graph.nodes, root, options.focus);
    if (starts.length === 0) throw new Error(`No ownership graph node matches '${options.focus}'`);
    const adjacent = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const from = adjacent.get(edge.from) ?? [];
      from.push(edge.to);
      adjacent.set(edge.from, from);
      const to = adjacent.get(edge.to) ?? [];
      to.push(edge.from);
      adjacent.set(edge.to, to);
    }
    const pending = starts.map((node) => ({ id: node.id, depth: 0 }));
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor]!;
      if (selected.has(current.id)) continue;
      if (selected.size >= options.maximumNodes) {
        selectionLimitReached = true;
        break;
      }
      selected.add(current.id);
      if (current.depth >= options.depth) continue;
      for (const id of adjacent.get(current.id) ?? []) {
        if (!selected.has(id)) pending.push({ id, depth: current.depth + 1 });
      }
    }
  } else {
    for (const node of graph.nodes) {
      if (!overviewKinds.has(node.kind)) continue;
      if (selected.size >= options.maximumNodes) {
        selectionLimitReached = true;
        break;
      }
      selected.add(node.id);
    }
  }

  const nodes = graph.nodes
    .filter((node) => selected.has(node.id))
    .map((node): ProjectLogicGraphNode => {
      const { path, ...rest } = node;
      return path ? { ...rest, path: portablePath(root, path)! } : rest;
    });
  const eligibleEdges = graph.edges.filter((edge) => selected.has(edge.from) && selected.has(edge.to));
  if (eligibleEdges.length > options.maximumEdges) selectionLimitReached = true;
  const edges = eligibleEdges.slice(0, options.maximumEdges)
    .map((edge): ProjectLogicGraphEdge => {
      const { path, ...rest } = edge;
      return path ? { ...rest, path: portablePath(root, path)! } : rest;
    });
  return {
    protocolVersion: 1,
    revision: graph.revision,
    root,
    focus: options.focus ?? null,
    depth: options.focus ? options.depth : 0,
    diagnostics: options.diagnostics,
    nodes,
    edges,
    coverage: graph.coverage,
    sourceLimitReached: graph.limitReached,
    selectionLimitReached,
  };
}

function oneLine(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

/**
 * GA-U7: the sources the human rendering reads positions out of, keyed by the
 * portable project-relative path the view already carries.
 *
 * `--json` keeps byte offsets, which is what a tool splices with. A person —
 * and a model reading the same text — needs the location every other line this
 * toolchain prints uses, `file:line:column`, so the human form converts. The
 * conversion needs the source, so the caller that has the compiled project
 * hands it in rather than the renderer reopening files.
 */
export function projectLogicGraphSources(project: ProjectResult, root: string): ReadonlyMap<string, SourceText> {
  return new Map(project.modules.map((module) => [portablePath(root, module.inputPath)!, module.result.source]));
}

export function renderProjectLogicGraph(
  view: ProjectLogicGraphView,
  sources: ReadonlyMap<string, SourceText> = new Map(),
): string {
  const aliases = new Map(view.nodes.map((node, index) => [node.id, `n${index + 1}`]));
  const lines = [
    `velar-logic-graph v${view.protocolVersion} revision=${view.revision}`,
    `scope=${view.focus ? `focus:${JSON.stringify(view.focus)} depth:${view.depth}` : "project-overview"} nodes=${view.nodes.length} edges=${view.edges.length} diagnostics=${view.diagnostics}`,
    `coverage=${view.coverage.modulesIncluded}/${view.coverage.modulesTotal} complete=${view.coverage.complete} sourceLimit=${view.sourceLimitReached} selectionLimit=${view.selectionLimitReached}`,
    "nodes:",
  ];
  for (const node of view.nodes) {
    const location = node.path ? ` ${node.path}${nodePosition(node, sources)}` : "";
    const flags = [node.exported ? "exported" : "", node.mutable ? "mutable" : ""].filter(Boolean).join(",");
    const type = node.type ? ` type=${JSON.stringify(oneLine(node.type))}` : "";
    const documentation = node.documentation ? ` doc=${JSON.stringify(oneLine(node.documentation))}` : "";
    lines.push(`${aliases.get(node.id)} ${node.kind} ${JSON.stringify(node.name)}${location}${flags ? ` [${flags}]` : ""}${type}${documentation}`);
  }
  lines.push("edges:");
  for (const edge of view.edges) {
    lines.push(`${aliases.get(edge.from)} -${edge.kind}-> ${aliases.get(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Where a node's declaration begins, in the one shape every other location
 * this toolchain prints has. A node whose source the caller did not hand in is
 * printed by path alone: an offset nobody can act on is not a position, and a
 * fabricated line would be worse than none.
 */
function nodePosition(node: ProjectLogicGraphNode, sources: ReadonlyMap<string, SourceText>): string {
  const source = node.path === undefined ? undefined : sources.get(node.path);
  if (source === undefined || !node.selectionSpan) return "";
  const location = source.location(node.selectionSpan.start);
  return `:${location.line}:${location.column}`;
}
