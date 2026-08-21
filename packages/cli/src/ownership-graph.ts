import { createHash } from "node:crypto";
import { dirname, extname, relative, resolve } from "node:path";
import type { SemanticReference, SemanticSymbol, Span } from "@velarscript/compiler";
import { projectImportKey, type ProjectModule, type ProjectResult } from "./project.ts";
import { byCodeUnit } from "./stable-order.ts";

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
  for (const module of [...project.modules].sort((left, right) => byCodeUnit(left.inputPath, right.inputPath))) {
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

/**
 * The owner-candidate symbols of one module, arranged so the smallest one
 * containing a span is found by binary search instead of by filtering and
 * sorting the module's whole symbol array once per symbol and once per
 * reference — which made the graph quadratic in the size of a module.
 *
 * Candidate spans are properly nested or disjoint (a method inside its class,
 * a nested `def` inside its parent), so they form a forest: the intervals
 * containing any span are a chain from a leaf to a root. If a module ever
 * violates that, `nested` records it and the original scan answers instead.
 */
interface OwnerIndex {
  readonly symbols: readonly SemanticSymbol[];
  readonly parents: readonly number[];
  readonly nested: boolean;
  readonly all: readonly SemanticSymbol[];
  readonly accepts: (symbol: SemanticSymbol) => boolean;
}

function ownerIndexFor(
  symbols: readonly SemanticSymbol[],
  accepts: (symbol: SemanticSymbol) => boolean,
): OwnerIndex {
  const chosen = symbols
    .filter(accepts)
    .sort((left, right) => left.span.start - right.span.start || right.span.end - left.span.end);
  const parents: number[] = [];
  const stack: number[] = [];
  let nested = true;
  for (let index = 0; index < chosen.length; index += 1) {
    const span = chosen[index]!.span;
    while (stack.length > 0) {
      const top = chosen[stack.at(-1)!]!.span;
      if (top.end >= span.end) break;
      // `top.start <= span.start` holds by the sort, so an end inside this
      // span rather than before its start is an improper overlap.
      if (top.end > span.start) nested = false;
      stack.pop();
    }
    parents.push(stack.at(-1) ?? -1);
    stack.push(index);
  }
  return { symbols: chosen, parents, nested, all: symbols, accepts };
}

/** The smallest indexed symbol whose span strictly contains `span`. */
function ownerAt(index: OwnerIndex, span: Span): SemanticSymbol | null {
  if (!index.nested) {
    return index.all
      .filter((symbol) => index.accepts(symbol) && contains(symbol.span, span))
      .sort((left, right) => (left.span.end - left.span.start) - (right.span.end - right.span.start))[0] ?? null;
  }
  let low = 0;
  let high = index.symbols.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.symbols[middle]!.span.start <= span.start) low = middle + 1;
    else high = middle;
  }
  for (let cursor = low - 1; cursor >= 0; cursor = index.parents[cursor]!) {
    const candidate = index.symbols[cursor]!;
    if (!contains(candidate.span, span)) continue;
    // Two candidates can carry the same span. The scan this replaces sorted by
    // width and took the first survivor, and `Array.prototype.sort` is stable,
    // so it answered with the one that came first in the module's symbol
    // array — which is the first of the equal-span run here.
    let first = cursor;
    while (first > 0) {
      const previous = index.symbols[first - 1]!;
      if (previous.span.start !== candidate.span.start || previous.span.end !== candidate.span.end) break;
      first -= 1;
    }
    return index.symbols[first]!;
  }
  return null;
}

function ownerOf(
  index: OwnerIndex,
  span: Span,
  stableByCompilerId: ReadonlyMap<string, string>,
  moduleId: string,
): string {
  return stableByCompilerId.get(ownerAt(index, span)?.id ?? "") ?? moduleId;
}

function referenceOwnerCandidate(symbol: SemanticSymbol): boolean {
  const kind = symbolKind(symbol);
  return ownerCandidate(symbol) || kind === "computed" || kind === "state";
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
  // The caps have to bound the work, not just the answer. Nodes and edges are
  // deduplicated as they are produced, so `maximumNodes` is an exact count and
  // generation can stop at it; once no further node can join, an edge whose
  // ends are not retained can never reach the answer either, so it is refused
  // at the source rather than built and filtered out at the end.
  const uniqueNodes = new Map<string, OwnershipGraphNode>();
  const uniqueEdges = new Map<string, OwnershipGraphEdge>();
  let skippedNodes = false;
  let skippedEdges = false;
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
  const nodesFinal = (): boolean => uniqueNodes.size >= maximumNodes;
  const addNode = (node: OwnershipGraphNode): void => {
    if (!uniqueNodes.has(node.id) && nodesFinal()) {
      skippedNodes = true;
      return;
    }
    uniqueNodes.set(node.id, node);
  };
  /** Nothing produced from here on can change the answer. */
  const exhausted = (): boolean => nodesFinal() && uniqueEdges.size >= maximumEdges;
  const addCapability = (source: string): string => {
    let id = capabilityIds.get(source);
    if (id) return id;
    id = capabilityIdentity(source);
    capabilityIds.set(source, id);
    addNode({ id, kind: "capability", name: source });
    return id;
  };
  const addEdge = (kind: OwnershipEdgeKind, from: string, to: string, path?: string, span?: Span): void => {
    // Asked before the identity is hashed: `uniqueNodes` only grows, so an
    // edge whose ends are not retained now was never retained, cannot already
    // be recorded, and would be filtered out of the answer regardless.
    if (nodesFinal() && (!uniqueNodes.has(from) || !uniqueNodes.has(to))) {
      skippedEdges = true;
      return;
    }
    const id = edgeIdentity(kind, from, to, path, span);
    if (!uniqueEdges.has(id) && nodesFinal() && uniqueEdges.size >= maximumEdges) {
      skippedEdges = true;
      return;
    }
    uniqueEdges.set(id, {
      id,
      kind,
      from,
      to,
      ...(path === undefined ? {} : { path }),
      ...(span === undefined ? {} : { span }),
    });
  };

  for (const module of project.modules) {
    await checkpoint();
    addNode({
      id: moduleIds.get(module.inputPath)!,
      kind: "module",
      name: module.relativePath,
      path: module.inputPath,
      span: { start: 0, end: module.result.source.text.length },
      selectionSpan: { start: 0, end: 0 },
    });
    const occurrences = new Map<string, number>();
    const symbols = module.result.semanticIndex.symbols;
    for (let index = 0; index < symbols.length; index += 1) {
      // The only cancellation poll and the only yield used to sit at the top
      // of the per-module loop, so one large module ran to completion
      // uninterruptibly however small a graph the client asked for.
      if ((index & 31) === 0) await checkpoint();
      const symbol = symbols[index]!;
      const key = `${symbol.kind}\0${symbol.container ?? ""}\0${symbol.name}`;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const id = symbolIdentity(project, module, symbol, occurrence);
      symbolIds.set(symbol.id, id);
      symbolByStableId.set(id, symbol);
      addNode({
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
    if (exhausted()) break;
    const moduleId = moduleIds.get(module.inputPath)!;
    const symbols = module.result.semanticIndex.symbols;
    const stableByCompilerId = new Map(symbols.map((symbol) => [symbol.id, symbolIds.get(symbol.id)!]));
    const importedCapabilities = importedCapabilityBySymbol(module);
    const sourceOwners = ownerIndexFor(symbols, ownerCandidate);
    const referenceOwners = ownerIndexFor(symbols, referenceOwnerCandidate);
    // `explicitContainer` re-scanned the whole symbol array per symbol looking
    // for one name; the first owner candidate under each name is what `find`
    // returned, so index that once.
    const containersByName = new Map<string, SemanticSymbol>();
    for (const symbol of symbols) {
      if (ownerCandidate(symbol) && !containersByName.has(symbol.name)) containersByName.set(symbol.name, symbol);
    }

    for (let index = 0; index < symbols.length; index += 1) {
      if ((index & 31) === 0) await checkpoint();
      if (exhausted()) break;
      const symbol = symbols[index]!;
      const id = symbolIds.get(symbol.id)!;
      // Everything this symbol can produce hangs off its own node — the `owns`
      // edge into it, and a readonly projection that would itself be refused.
      // With the node roster already closed against it, none of that can reach
      // the answer, so the owner lookup is not worth doing.
      if (nodesFinal() && !uniqueNodes.has(id)) continue;
      const explicitContainer = symbol.container ? containersByName.get(symbol.container) ?? null : null;
      const owner = explicitContainer
        ? stableByCompilerId.get(explicitContainer.id)!
        : ownerOf(sourceOwners, symbol.selectionSpan, stableByCompilerId, moduleId);
      addEdge("owns", owner === id ? moduleId : owner, id);
      if (readonlyProjection(symbol.type)) {
        const projectionId = `readonly:${shortHash(id)}`;
        addNode({
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

    const references = module.result.semanticIndex.references;
    for (let index = 0; index < references.length; index += 1) {
      if ((index & 31) === 0) await checkpoint();
      if (exhausted()) break;
      const reference = references[index]!;
      const target = reference.symbolId ? stableByCompilerId.get(reference.symbolId) : null;
      if (!target) continue;
      // Same shape: every edge this reference can raise ends at `target` or at
      // a capability node that can no longer be created.
      if (nodesFinal() && !uniqueNodes.has(target)) continue;
      const owner = ownerOf(referenceOwners, reference.span, stableByCompilerId, moduleId);
      const kind: OwnershipEdgeKind = reference.call ? "calls" : reference.write ? "writes" : "reads";
      addEdge(kind, owner, target, reference.path, reference.span);
      if (symbolByStableId.get(owner) && symbolKind(symbolByStableId.get(owner)!) === "computed" && !reference.write) {
        addEdge("derives", owner, target, reference.path, reference.span);
      }
      const capability = reference.symbolId ? importedCapabilities.get(reference.symbolId) : null;
      if (capability) addEdge("crossesCapability", owner, addCapability(capability), reference.path, reference.span);
    }
  }

  const nodes = [...uniqueNodes.values()];
  const eligibleEdges = [...uniqueEdges.values()].filter((edge) => uniqueNodes.has(edge.from) && uniqueNodes.has(edge.to));
  const edges = eligibleEdges.slice(0, maximumEdges);
  const limitReached = skippedNodes || skippedEdges || edges.length < uniqueEdges.size;
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
