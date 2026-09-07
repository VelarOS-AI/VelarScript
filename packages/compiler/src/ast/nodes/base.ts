/**
 * The shapes every other AST family reads: the module root, the two statement
 * and expression unions, the opaque extension nodes those unions leave room
 * for, a parameter, and the one thing every node has in common.
 *
 * This is the leaf of `ast/`. The unions name each node interface the sibling
 * files declare, and those files name `Statement` and `Expression` back —
 * mutual recursion is what an AST *is*, and every edge here is `import type`,
 * so nothing is emitted and no module waits for another at run time.
 */
import type { Span } from "../../source.ts";
import type { TypeReference } from "./types.ts";
import type {
  AssertStatement,
  AssignmentStatement,
  BreakStatement,
  ClassDeclaration,
  ContinueStatement,
  DetachStatement,
  EmbeddedJavaScriptDeclaration,
  EnumDeclaration,
  ExpressionStatement,
  ExternModuleDeclaration,
  ForStatement,
  FunctionDeclaration,
  IfStatement,
  ImportDeclaration,
  MainBlock,
  MatchStatement,
  PassStatement,
  ReExportDeclaration,
  ReturnStatement,
  TestDeclaration,
  ThrowStatement,
  TryStatement,
  TypeAliasDeclaration,
  TypeDeclaration,
  UsingDeclaration,
  VariableDeclaration,
  WhileStatement,
} from "./statements.ts";
import type {
  ArrowFunctionExpression,
  AssignmentExpression,
  BinaryExpression,
  CallExpression,
  ComparisonChainExpression,
  ConditionalExpression,
  CoreDurationExpression,
  DynamicImportExpression,
  FStringExpression,
  IdentifierExpression,
  IndexExpression,
  IsExpression,
  ListExpression,
  LiteralExpression,
  MemberExpression,
  ObjectExpression,
  RequiredExpression,
  SpreadExpression,
  SuperExpression,
  TryExpression,
  UnaryExpression,
} from "./expressions.ts";

export interface Program {
  readonly kind: "Program";
  readonly body: readonly Statement[];
  /**
   * Core-owned, compile-time-only business context attached to top-level
   * declarations. The marker is kept beside the statement tree so it does not
   * introduce a runtime wrapper or a lexical scope.
   */
  readonly contextMarkers?: readonly ContextMarker[];
  readonly span: Span;
}

export interface ContextMarker {
  readonly name: string;
  readonly nameSpan: Span;
  readonly markerSpan: Span;
  readonly targetSpan: Span;
}

export type CoreStatement =
  | ImportDeclaration
  | ReExportDeclaration
  | ExternModuleDeclaration
  | EmbeddedJavaScriptDeclaration
  | TypeDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration
  | ClassDeclaration
  | VariableDeclaration
  | UsingDeclaration
  | TestDeclaration
  | MainBlock
  | FunctionDeclaration
  | ReturnStatement
  | ThrowStatement
  | AssertStatement
  | IfStatement
  | MatchStatement
  | ForStatement
  | WhileStatement
  | BreakStatement
  | ContinueStatement
  | TryStatement
  | PassStatement
  | AssignmentStatement
  | ExpressionStatement
  | DetachStatement;

export type Statement = CoreStatement | ExtensionStatement;

/**
 * Target and framework syntax travels through one opaque Core AST slot. The
 * template-literal discriminator keeps extension nodes disjoint from Core
 * node names while allowing an extension package to publish its own strongly
 * typed node interfaces without changing this union.
 */
export interface ExtensionStatement {
  readonly kind: `ExtensionStatement:${string}`;
  readonly span: Span;
}

export type CoreExpression =
  | LiteralExpression
  | FStringExpression
  | IdentifierExpression
  | SuperExpression
  | DynamicImportExpression
  | ListExpression
  | ObjectExpression
  | SpreadExpression
  | UnaryExpression
  | RequiredExpression
  | TryExpression
  | BinaryExpression
  | AssignmentExpression
  | ComparisonChainExpression
  | ConditionalExpression
  | IsExpression
  | ArrowFunctionExpression
  | CallExpression
  | MemberExpression
  | IndexExpression
  | CoreDurationExpression;

export type Expression = CoreExpression | ExtensionExpression;

/** See ExtensionStatement. */
export interface ExtensionExpression {
  readonly kind: `ExtensionExpression:${string}`;
  readonly span: Span;
}

export interface Parameter {
  readonly name: string;
  readonly type: TypeReference | null;
  readonly defaultValue: Expression | null;
  readonly rest: boolean;
  readonly span: Span;
}

/** Anything the AST puts a `kind` on: a node, a pattern, an f-string part. */
export interface AstNode {
  readonly kind: string;
}
