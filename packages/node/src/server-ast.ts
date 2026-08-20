import type { Expression, Parameter, Span, Statement, TypeReference } from "@velarscript/compiler/extension";

export const NODE_HTTP_METHODS = Object.freeze(["get", "post", "put", "patch", "delete"] as const);

export type NodeHttpMethodName = typeof NODE_HTTP_METHODS[number];
export type NodeHttpMethod = Uppercase<NodeHttpMethodName>;

export interface NodeServerDeclaration {
  readonly kind: "ExtensionStatement:node:server";
  readonly exported: boolean;
  readonly name: string;
  readonly items: readonly NodeServerItem[];
  readonly span: Span;
}

export type NodeServerItem = NodeRouteDeclaration | NodeNotFoundDeclaration | NodeServerSpread;

export interface NodeServerSpread {
  readonly kind: "NodeServerSpread";
  readonly value: Expression;
  readonly span: Span;
}

export interface NodeRouteDeclaration {
  readonly kind: "NodeRouteDeclaration";
  /** Internal diagnostic identity. Routes do not introduce a source binding. */
  readonly name: string;
  readonly method: NodeHttpMethod;
  readonly path: string;
  readonly pathSpan: Span;
  readonly parameters: readonly Parameter[];
  readonly returnType: TypeReference | null;
  readonly resultAnnotationSpan?: Span;
  readonly signatureSpan: Span;
  readonly body: readonly Statement[];
  readonly expressionBody: boolean;
  readonly span: Span;
}

export interface NodeNotFoundDeclaration {
  readonly kind: "NodeNotFoundDeclaration";
  /** Internal diagnostic identity. A fallback does not introduce a source binding. */
  readonly name: "notFound";
  readonly parameters: readonly Parameter[];
  readonly returnType: TypeReference | null;
  readonly resultAnnotationSpan?: Span;
  readonly signatureSpan: Span;
  readonly body: readonly Statement[];
  readonly expressionBody: boolean;
  readonly span: Span;
}

export const NODE_STATEMENT_CONSTRUCTS = Object.freeze({
  "ExtensionStatement:node:server": "server name:",
});

export type NodeStatementConstructKey = keyof typeof NODE_STATEMENT_CONSTRUCTS;

export function nodeStatementConstructKey(node: { readonly kind: string }): NodeStatementConstructKey | null {
  return node.kind === "ExtensionStatement:node:server" ? node.kind : null;
}

export function isNodeServerStatement(statement: Statement): statement is NodeServerDeclaration {
  return statement.kind === "ExtensionStatement:node:server";
}

export function nodeServerStatementContainsDirectAwait(
  statement: Statement,
  _containsExpression: (expression: Expression) => boolean,
  _containsBlock: (statements: readonly Statement[]) => boolean,
): boolean | undefined {
  // Route handlers are deferred async boundaries. Their awaits do not make
  // module initialization asynchronous.
  return isNodeServerStatement(statement) ? false : undefined;
}
