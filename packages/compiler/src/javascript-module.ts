import {
  parse,
  type AnyNode,
  type Program,
} from "acorn";

export const MAX_JAVASCRIPT_MODULE_SYNTAX_NODES = 2_000_000;
export const MAX_JAVASCRIPT_MODULE_TOKENS = 1_000_000;

export interface JavaScriptModuleEdge {
  /** Null means a dynamic import whose target cannot be proved statically. */
  readonly source: string | null;
  readonly dynamic: boolean;
  readonly start: number;
  readonly end: number;
}

export interface JavaScriptModuleInspection {
  readonly edges: readonly JavaScriptModuleEdge[];
  readonly syntaxNodes: number;
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
  return inspectParsedJavaScriptModule(program, maximum);
}

function inspectParsedJavaScriptModule(
  program: Program,
  maximumSyntaxNodes = MAX_JAVASCRIPT_MODULE_SYNTAX_NODES,
): JavaScriptModuleInspection {
  const maximum = syntaxNodeBudget(maximumSyntaxNodes);
  const pending: AnyNode[] = [program];
  const visited = new WeakSet<object>();
  const edges: JavaScriptModuleEdge[] = [];
  let syntaxNodes = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    syntaxNodes += 1;
    if (syntaxNodes > maximum) {
      throw new RangeError(`JavaScript module syntax tree exceeds ${maximum} nodes`);
    }
    const edge = moduleEdge(node);
    if (edge !== null) edges.push(edge);
    pushChildNodes(node, pending);
  }
  edges.sort((left, right) => left.start - right.start || left.end - right.end);
  return { edges, syntaxNodes };
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

function pushChildNodes(node: AnyNode, pending: AnyNode[]): void {
  const fields = Object.entries(node);
  for (let fieldIndex = fields.length - 1; fieldIndex >= 0; fieldIndex -= 1) {
    const [key, value] = fields[fieldIndex]!;
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        if (isNode(value[index])) pending.push(value[index]);
      }
    } else if (isNode(value)) {
      pending.push(value);
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
