import { createHash } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import type { SemanticReference, SemanticSymbol, Span } from "@velarscript/compiler";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";

export type OwnershipNodeKind =
  | "module"
  | "component"
  | "state"
  | "computed"
  | "action"
  | "function"
  | "class"
  | "type"
  | "enum"
  | "variable"
  | "parameter"
  | "member"
  | "import"
  | "capability"
  | "readonlyProjection";

export type OwnershipEdgeKind =
  | "imports"
  | "owns"
  | "reads"
  | "writes"
  | "derives"
  | "calls"
  | "crossesCapability"
  | "projectsReadonly";

export interface OwnershipGraphNode {
  readonly id: string;
  readonly kind: OwnershipNodeKind;
  readonly name: string;
  readonly path?: string;
  readonly span?: Span;
  readonly selectionSpan?: Span;
  readonly type?: string;
  readonly exported?: boolean;
  readonly mutable?: boolean;
}

export interface OwnershipGraphEdge {
  readonly id: string;
  readonly kind: OwnershipEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly path?: string;
  readonly span?: Span;
}

export interface OwnershipGraphCoverage {
  readonly modulesTotal: number;
  readonly modulesIncluded: number;
  readonly complete: boolean;
  readonly callRelations: "direct-local-callees";
  readonly memberCallRelations: false;
}

export interface OwnershipGraphResult {
  readonly revision: string;
  readonly nodes: readonly OwnershipGraphNode[];
  readonly edges: readonly OwnershipGraphEdge[];
  readonly coverage: OwnershipGraphCoverage;
  readonly limitReached: boolean;
  readonly durationMs: number;
}

export interface OwnershipGraphOptions {
  readonly maximumNodes?: number;
  readonly maximumEdges?: number;
  readonly cancelled?: () => boolean;
}

const DEFAULT_MAXIMUM_NODES = 10_000;
const DEFAULT_MAXIMUM_EDGES = 20_000;

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function ownershipGraphRevision(project: ProjectResult): string {
  const hash = createHash("sha256");
  for (const module of [...project.modules].sort((left, right) => left.inputPath.localeCompare(right.inputPath))) {
    hash.update(relative(project.projectRoot, module.inputPath));
    hash.update("\0");
    hash.update(module.result.source.text);
    hash.update("\0");
  }
  for (const extension of project.compilerExtensions) hash.update(`${extension.id}\0`);
  return hash.digest("hex");
}

function symbolKind(symbol: SemanticSymbol): OwnershipNodeKind {
  if (symbol.kind === "extension:function:web-component") return "component";
  if (symbol.kind === "extension:variable:web-state") return "state";
  if (symbol.kind === "extension:variable:web-computed") return "computed";
  if (symbol.kind === "extension:function:web-action") return "action";
  if (symbol.kind === "function" || symbol.kind === "method" || symbol.kind.startsWith("extension:function:")) return "function";
  if (symbol.kind === "class") return "class";
  if (symbol.kind === "type") return "type";
  if (symbol.kind === "enum" || symbol.kind === "enum-member") return "enum";
  if (symbol.kind === "parameter" || symbol.kind === "catch" || symbol.kind.startsWith("extension:parameter:")) return "parameter";
  if (symbol.kind === "field") return "member";
  if (symbol.kind === "import") return "import";
  return "variable";
}

function symbolIdentity(project: ProjectResult, module: ProjectModule, symbol: SemanticSymbol, occurrence: number): string {
  return `symbol:${shortHash([
    relative(project.projectRoot, module.inputPath),
    symbol.kind,
    symbol.container ?? "",
    symbol.name,
    String(occurrence),
  ].join("\0"))}`;
}

function moduleIdentity(project: ProjectResult, path: string): string {
  return `module:${shortHash(relative(project.projectRoot, path))}`;
}

function capabilityIdentity(source: string): string {
  return `capability:${shortHash(source)}`;
}

function readonlyProjection(type: string | null): boolean {
  return typeof type === "string" && /(?:^|[<({|, ]+)readonly(?:[>)}|, ]|$)/u.test(type);
}

function contains(owner: Span, child: Span): boolean {
  return owner.start <= child.start && owner.end >= child.end
    && (owner.start !== child.start || owner.end !== child.end);
}

function ownerCandidate(symbol: SemanticSymbol): boolean {
  const kind = symbolKind(symbol);
  return kind === "component" || kind === "action" || kind === "function" || kind === "class";
}

function sourceOwner(
  module: ProjectModule,
  span: Span,
  stableByCompilerId: ReadonlyMap<string, string>,
  moduleId: string,
): string {
  const candidates = module.result.semanticIndex.symbols
    .filter((symbol) => ownerCandidate(symbol) && contains(symbol.span, span))
    .sort((left, right) => (left.span.end - left.span.start) - (right.span.end - right.span.start));
  return stableByCompilerId.get(candidates[0]?.id ?? "") ?? moduleId;
}

function referenceOwner(
  module: ProjectModule,
  span: Span,
  stableByCompilerId: ReadonlyMap<string, string>,
  moduleId: string,
): string {
  const candidates = module.result.semanticIndex.symbols
    .filter((symbol) => {
      const kind = symbolKind(symbol);
      return contains(symbol.span, span) && (ownerCandidate(symbol) || kind === "computed" || kind === "state");
    })
    .sort((left, right) => (left.span.end - left.span.start) - (right.span.end - right.span.start));
  return stableByCompilerId.get(candidates[0]?.id ?? "") ?? moduleId;
}

function resolvedModule(project: ProjectResult, importer: string, source: string): string | null {
  const path = source.startsWith(".") && extname(source) === ".vel"
    ? resolve(dirname(importer), source)
    : project.velarImports.get(projectImportKey(importer, source)) ?? null;
  return path && project.modules.some((module) => module.inputPath === path) ? path : null;
}

function capabilitySource(source: string, javascript: boolean): boolean {
  return javascript || source.startsWith("velar/");
}

function importedCapabilityBySymbol(module: ProjectModule): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const imported of module.result.semanticIndex.imports) {
    if (capabilitySource(imported.source, module.result.dependencies.find((item) => item.source === imported.source)?.javascript ?? false)) {
      output.set(imported.localSymbolId, imported.source);
    }
  }
  return output;
}

function edgeIdentity(kind: OwnershipEdgeKind, from: string, to: string, path?: string, span?: Span): string {
  return `edge:${shortHash(`${kind}\0${from}\0${to}\0${path ?? ""}\0${span?.start ?? ""}:${span?.end ?? ""}`)}`;
}

export async function buildOwnershipGraph(project: ProjectResult, options: OwnershipGraphOptions = {}): Promise<OwnershipGraphResult> {
  const startedAt = performance.now();
  const maximumNodes = Math.max(1, Math.min(20_000, Math.floor(options.maximumNodes ?? DEFAULT_MAXIMUM_NODES)));
  const maximumEdges = Math.max(1, Math.min(40_000, Math.floor(options.maximumEdges ?? DEFAULT_MAXIMUM_EDGES)));
  const candidateNodes: OwnershipGraphNode[] = [];
  const candidateEdges: OwnershipGraphEdge[] = [];
  const moduleIds = new Map(project.modules.map((module) => [module.inputPath, moduleIdentity(project, module.inputPath)]));
  const symbolIds = new Map<string, string>();
  const symbolByStableId = new Map<string, SemanticSymbol>();
  const capabilityIds = new Map<string, string>();
  let work = 0;
  const checkpoint = async (): Promise<void> => {
    if (options.cancelled?.()) throw new Error("Ownership graph request cancelled");
    work += 1;
    if (work % 128 === 0) await new Promise<void>((resolveYield) => setImmediate(resolveYield));
  };
  const addCapability = (source: string): string => {
    let id = capabilityIds.get(source);
    if (id) return id;
    id = capabilityIdentity(source);
    capabilityIds.set(source, id);
    candidateNodes.push({ id, kind: "capability", name: source });
    return id;
  };
  const addEdge = (kind: OwnershipEdgeKind, from: string, to: string, path?: string, span?: Span): void => {
    candidateEdges.push({
      id: edgeIdentity(kind, from, to, path, span),
      kind,
      from,
      to,
      ...(path === undefined ? {} : { path }),
      ...(span === undefined ? {} : { span }),
    });
  };

  for (const module of project.modules) {
    await checkpoint();
    candidateNodes.push({
      id: moduleIds.get(module.inputPath)!,
      kind: "module",
      name: module.relativePath,
      path: module.inputPath,
      span: { start: 0, end: module.result.source.text.length },
      selectionSpan: { start: 0, end: 0 },
    });
    const occurrences = new Map<string, number>();
    for (const symbol of module.result.semanticIndex.symbols) {
      const key = `${symbol.kind}\0${symbol.container ?? ""}\0${symbol.name}`;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const id = symbolIdentity(project, module, symbol, occurrence);
      symbolIds.set(symbol.id, id);
      symbolByStableId.set(id, symbol);
      candidateNodes.push({
        id,
        kind: symbolKind(symbol),
        name: symbol.name,
        path: symbol.path,
        span: symbol.span,
        selectionSpan: symbol.selectionSpan,
        ...(symbol.type ? { type: symbol.type } : {}),
        exported: symbol.exported,
        mutable: symbol.mutable,
      });
    }
  }

  for (const module of project.modules) {
    await checkpoint();
    const moduleId = moduleIds.get(module.inputPath)!;
    const stableByCompilerId = new Map(module.result.semanticIndex.symbols.map((symbol) => [symbol.id, symbolIds.get(symbol.id)!]));
    const importedCapabilities = importedCapabilityBySymbol(module);

    for (const symbol of module.result.semanticIndex.symbols) {
      const id = symbolIds.get(symbol.id)!;
      const explicitContainer = symbol.container
        ? module.result.semanticIndex.symbols.find((candidate) => candidate.name === symbol.container && ownerCandidate(candidate))
        : null;
      const owner = explicitContainer
        ? stableByCompilerId.get(explicitContainer.id)!
        : sourceOwner(module, symbol.selectionSpan, stableByCompilerId, moduleId);
      addEdge("owns", owner === id ? moduleId : owner, id);
      if (readonlyProjection(symbol.type)) {
        const projectionId = `readonly:${shortHash(id)}`;
        candidateNodes.push({
          id: projectionId,
          kind: "readonlyProjection",
          name: `${symbol.name} readonly view`,
          path: symbol.path,
          span: symbol.span,
          selectionSpan: symbol.selectionSpan,
          ...(symbol.type ? { type: symbol.type } : {}),
        });
        addEdge("projectsReadonly", id, projectionId, symbol.path, symbol.selectionSpan);
      }
    }

    for (const dependency of module.result.dependencies) {
      const targetPath = resolvedModule(project, module.inputPath, dependency.source);
      if (targetPath) addEdge("imports", moduleId, moduleIds.get(targetPath)!);
      else if (capabilitySource(dependency.source, dependency.javascript)) {
        addEdge("imports", moduleId, addCapability(dependency.source));
      }
    }

    for (const [compilerSymbolId, source] of importedCapabilities) {
      const importedId = stableByCompilerId.get(compilerSymbolId);
      if (importedId) addEdge("crossesCapability", importedId, addCapability(source));
    }

    for (const reference of module.result.semanticIndex.references) {
      const target = reference.symbolId ? stableByCompilerId.get(reference.symbolId) : null;
      if (!target) continue;
      const owner = referenceOwner(module, reference.span, stableByCompilerId, moduleId);
      const kind: OwnershipEdgeKind = reference.call ? "calls" : reference.write ? "writes" : "reads";
      addEdge(kind, owner, target, reference.path, reference.span);
      if (symbolByStableId.get(owner) && symbolKind(symbolByStableId.get(owner)!) === "computed" && !reference.write) {
        addEdge("derives", owner, target, reference.path, reference.span);
      }
      const capability = reference.symbolId ? importedCapabilities.get(reference.symbolId) : null;
      if (capability) addEdge("crossesCapability", owner, addCapability(capability), reference.path, reference.span);
    }
  }

  const uniqueNodes = [...new Map(candidateNodes.map((node) => [node.id, node])).values()];
  const uniqueEdges = [...new Map(candidateEdges.map((edge) => [edge.id, edge])).values()];
  const nodes = uniqueNodes.slice(0, maximumNodes);
  const retained = new Set(nodes.map((node) => node.id));
  const eligibleEdges = uniqueEdges.filter((edge) => retained.has(edge.from) && retained.has(edge.to));
  const edges = eligibleEdges.slice(0, maximumEdges);
  const limitReached = nodes.length < uniqueNodes.length || edges.length < uniqueEdges.length;
  const modulesIncluded = nodes.filter((node) => node.kind === "module").length;
  return {
    revision: ownershipGraphRevision(project),
    nodes,
    edges,
    coverage: {
      modulesTotal: project.modules.length,
      modulesIncluded,
      complete: !limitReached && modulesIncluded === project.modules.length,
      callRelations: "direct-local-callees",
      memberCallRelations: false,
    },
    limitReached,
    durationMs: performance.now() - startedAt,
  };
}
