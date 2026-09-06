import {
  parse,
  type AnyNode,
  type Program,
} from "acorn";

import { inspectJavaScriptOpaqueModuleLoads } from "./javascript-opaque-loader.ts";

export const MAX_JAVASCRIPT_MODULE_SYNTAX_NODES = 2_000_000;
export const MAX_JAVASCRIPT_MODULE_TOKENS = 1_000_000;

export interface JavaScriptModuleEdge {
  /** Null means a dynamic import whose target cannot be proved statically. */
  readonly source: string | null;
  readonly dynamic: boolean;
  readonly start: number;
  readonly end: number;
}

export interface JavaScriptOpaqueModuleLoad {
  readonly kind: "commonjs-require" | "create-require" | "get-builtin-module";
  /** A statically provable loader target; createRequire itself has no module target. */
  readonly target: string | null;
  /** True only for an unshadowed direct `require(...)` call that a bundler can close. */
  readonly bundlerVisible: boolean;
  readonly start: number;
  readonly end: number;
}

export interface JavaScriptModuleInspection {
  readonly edges: readonly JavaScriptModuleEdge[];
  /** Runtime loaders whose target graph cannot be proved from ESM edges. */
  readonly opaqueLoads: readonly JavaScriptOpaqueModuleLoad[];
  readonly syntaxNodes: number;
  /** Tokens consumed while parsing, for callers that enforce a graph-wide budget. */
  readonly tokens: number;
}

export interface JavaScriptModuleInspectionOptions {
  /** A per-call budget, capped by MAX_JAVASCRIPT_MODULE_SYNTAX_NODES. */
  readonly maximumSyntaxNodes?: number;
  /** A parse-time budget, capped by MAX_JAVASCRIPT_MODULE_TOKENS. */
  readonly maximumTokens?: number;
}

/** Parses one complete ECMAScript module and enumerates all of its module edges. */
export function inspectJavaScriptModule(
  source: string,
  options: JavaScriptModuleInspectionOptions = {},
): JavaScriptModuleInspection {
  const maximum = syntaxNodeBudget(options.maximumSyntaxNodes);
  const maximumTokens = tokenBudget(options.maximumTokens);
  let tokens = 0;
  const program = parse(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    onToken() {
      tokens += 1;
      if (tokens > maximumTokens) throw new RangeError(`JavaScript module token stream exceeds ${maximumTokens} tokens`);
    },
    sourceType: "module",
  });
  const loaderInspection = inspectJavaScriptOpaqueModuleLoads(program, maximum);
  return {
    edges: inspectJavaScriptModuleEdges(program),
    opaqueLoads: loaderInspection.opaqueLoads,
    syntaxNodes: loaderInspection.syntaxNodes,
    tokens,
  };
}

function inspectJavaScriptModuleEdges(program: Program): JavaScriptModuleEdge[] {
  const edges: JavaScriptModuleEdge[] = [];
  const pending: AnyNode[] = [program];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const found = moduleEdge(current);
    if (found !== null) edges.push(found);
    forEachChildNode(current, (child) => pending.push(child));
  }
  edges.sort((left, right) => left.start - right.start || left.end - right.end);
  return edges;
}

function moduleEdge(node: AnyNode): JavaScriptModuleEdge | null {
  if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
    return edge(staticNodeSource(node.source), false, node.source);
  }
  if (node.type === "ExportNamedDeclaration" && node.source !== null && node.source !== undefined) {
    return edge(staticNodeSource(node.source), false, node.source);
  }
  if (node.type !== "ImportExpression") return null;
  const source = (node as AnyNode & { readonly source?: AnyNode }).source;
  return source === undefined
    ? edge(null, true, node)
    : edge(provableDynamicSource(source), true, source);
}

function edge(
  source: string | null,
  dynamic: boolean,
  node: Pick<AnyNode, "start" | "end">,
): JavaScriptModuleEdge {
  return { source, dynamic, start: node.start, end: node.end };
}

function staticNodeSource(source: { readonly value?: unknown }): string {
  if (typeof source.value !== "string") {
    throw new TypeError("ECMAScript module declaration has no static string target");
  }
  return source.value;
}

function provableDynamicSource(source: AnyNode): string | null {
  if (source.type === "Literal") {
    const value = (source as AnyNode & { readonly value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  if (source.type !== "TemplateLiteral") return null;
  const template = source as AnyNode & {
    readonly expressions?: readonly unknown[];
    readonly quasis?: readonly { readonly value?: { readonly cooked?: unknown } }[];
  };
  if (template.expressions?.length !== 0 || template.quasis?.length !== 1) return null;
  const cooked = template.quasis[0]?.value?.cooked;
  return typeof cooked === "string" ? cooked : null;
}

function forEachChildNode(node: AnyNode, visit: (child: AnyNode) => void): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child);
    } else if (isNode(value)) {
      visit(value);
    }
  }
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && typeof (value as { readonly type?: unknown }).type === "string";
}

function syntaxNodeBudget(value = MAX_JAVASCRIPT_MODULE_SYNTAX_NODES): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_JAVASCRIPT_MODULE_SYNTAX_NODES) {
    throw new RangeError(`maximumSyntaxNodes must be an integer from 1 to ${MAX_JAVASCRIPT_MODULE_SYNTAX_NODES}`);
  }
  return value;
}

function tokenBudget(value = MAX_JAVASCRIPT_MODULE_TOKENS): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_JAVASCRIPT_MODULE_TOKENS) {
    throw new RangeError(`maximumTokens must be an integer from 1 to ${MAX_JAVASCRIPT_MODULE_TOKENS}`);
  }
  return value;
}
