import type { Expression, Parameter, Span, Statement, TypeReference } from "@velarscript/compiler/extension";
import type { CompiledRoutePattern, RoutePatternCapture } from "./route-pattern.ts";

export const NODE_HTTP_METHODS = Object.freeze(["get", "post", "put", "patch", "delete"] as const);

export type NodeHttpMethodName = typeof NODE_HTTP_METHODS[number];
export type NodeHttpMethod = Uppercase<NodeHttpMethodName>;
export type NodeRouteTransport = "http" | "websocket";
export type NodeRouteMethod = NodeHttpMethod | "WEBSOCKET";

export interface NodeServerDeclaration {
  readonly kind: "ExtensionStatement:node:server";
  readonly exported: boolean;
  readonly name: string;
  readonly items: readonly NodeServerItem[];
  readonly span: Span;
}

export type NodeServerItem = NodeRouteDeclaration | NodeNotFoundDeclaration | NodeResponseDeclaration | NodeServerSpread;

export interface NodePathPatternExpression {
  readonly kind: "ExtensionExpression:node:path-pattern";
  readonly pattern: CompiledRoutePattern;
  readonly span: Span;
}

export interface NodeServerSpread {
  readonly kind: "NodeServerSpread";
  readonly value: Expression;
  readonly span: Span;
}

export interface NodeRouteDeclaration {
  readonly kind: "NodeRouteDeclaration";
  /** Internal diagnostic identity. Routes do not introduce a source binding. */
  readonly name: string;
  readonly method: NodeRouteMethod;
  /** HTTP 请求响应路由，或由框架拥有连接任务的 WebSocket 会话路由。 */
  readonly transport: NodeRouteTransport;
  /** 路由注解第一个位置参数中的静态 RoutePattern 表达式。 */
  readonly pathExpression: Expression;
  readonly path: string;
  readonly pathSpan: Span;
  /**
   * `p"..." as route` 显式绑定的一次请求匹配对象。为空时，内联模式中的
   * path/query 捕获会作为只读参数直接投影进处理器作用域。
   */
  readonly routeBinding: { readonly name: string; readonly span: Span } | null;
  /** 直接投影模式拥有的捕获；对象模式和非内联模式始终为空。 */
  readonly projectedCaptures: readonly RoutePatternCapture[];
  /** 由作者显式声明的请求体、Request、依赖和其他输入。 */
  readonly inputParameters: readonly Parameter[];
  /** 分析器可见的完整处理器作用域：投影/route 绑定在前，显式输入在后。 */
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

export interface NodeResponseDeclaration {
  readonly kind: "NodeResponseDeclaration";
  readonly name: "response";
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
