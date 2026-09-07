/**
 * The helpers that read a tree rather than describe one: the structural walk,
 * the two questions the parser, formatter and CLI ask about a statement, the
 * module's startup code, a test's emitted name, and the direct-await traversal.
 *
 * Everything here is a *reader*. The nodes it reads are declared in `nodes/`,
 * and nothing in `nodes/` reads back.
 */
import type { Span } from "../source.ts";
import type { AstNode, CoreExpression, CoreStatement, Expression, Program, Statement } from "./nodes/base.ts";
import type { TestDeclaration } from "./nodes/statements.ts";

/**
 * The top-level statement forms that declare rather than execute — exactly the
 * ones a module may keep outside its `@main` region.
 *
 * An extension statement is declarative by definition: the framework that owns
 * `component`, `server` and their kin decides what its own top level means, and
 * Core cannot read a legal declaration as stray executable code.
 */
const MODULE_DECLARATION_STATEMENT_KINDS: ReadonlySet<Statement["kind"]> = new Set<Statement["kind"]>([
  "ImportDeclaration",
  "ReExportDeclaration",
  "ExternModuleDeclaration",
  "EmbeddedJavaScriptDeclaration",
  "TypeDeclaration",
  "TypeAliasDeclaration",
  "EnumDeclaration",
  "ClassDeclaration",
  "VariableDeclaration",
  "TestDeclaration",
  "FunctionDeclaration",
  "MainBlock",
]);

export function isModuleDeclarationStatement(statement: Statement): boolean {
  return statement.kind.startsWith("ExtensionStatement:") || MODULE_DECLARATION_STATEMENT_KINDS.has(statement.kind);
}

/**
 * Whether the statement heads a suite of its own.
 *
 * Three readers need this one answer and had a copy each: the parser, which
 * refuses a block header as the whole of an inline `header: statement` body;
 * the formatter, which decides where a compact suite may be kept; and the
 * application-entry migration, which may only wrap a statement the inline
 * `@main:` body accepts.
 */
export function statementOwnsBlock(statement: Statement): boolean {
  if (statement.kind.startsWith("ExtensionStatement:")) return true;
  switch (statement.kind) {
    case "ExternModuleDeclaration":
    case "EmbeddedJavaScriptDeclaration":
    case "TypeDeclaration":
    case "EnumDeclaration":
    case "ClassDeclaration":
    case "TestDeclaration":
    case "MainBlock":
    case "FunctionDeclaration":
    case "IfStatement":
    case "MatchStatement":
    case "ForStatement":
    case "WhileStatement":
    case "TryStatement":
      return true;
    default:
      return false;
  }
}

/**
 * The module's startup code as it stands at the top level, which is where a
 * module that has no `@main` region keeps it.
 *
 * The parser refuses these statements outright once a `@main` exists, and the
 * CLI's application-entry contract refuses a *missing* `@main` — the same rule
 * read from its two ends. This is published so that the second end can tell the
 * one shape it can migrate mechanically from the shapes it must hand back.
 */
export interface ModuleStartupStatement {
  /** The statement's author span. */
  readonly span: Span;
  /** `statementOwnsBlock`, carried so a caller holding no AST can still ask. */
  readonly opensBlock: boolean;
}

export interface ModuleStartupCode {
  /** The top-level statements that are not declarations, in source order. */
  readonly statements: readonly ModuleStartupStatement[];
  /** True when the last of them is the module's final top-level statement — nothing declared follows it. */
  readonly trailing: boolean;
}

export function moduleStartupCode(program: Program): ModuleStartupCode {
  const statements: ModuleStartupStatement[] = [];
  let last = -1;
  for (const [index, statement] of program.body.entries()) {
    if (isModuleDeclarationStatement(statement)) continue;
    statements.push({ span: statement.span, opensBlock: statementOwnsBlock(statement) });
    last = index;
  }
  return { statements, trailing: last >= 0 && last === program.body.length - 1 };
}

/** The generated function name a `test "name":` block emits and the runner calls. */
export function testFunctionName(statement: TestDeclaration): string {
  return `__velarTest${statement.span.start}`;
}

/**
 * Every node under `root`, in source order, whatever shape it has.
 *
 * The walk is structural: it descends through arrays and objects without
 * asking what they are, so it reaches a container the day the parser produces
 * one — a new class member, a new statement form, an extension node this
 * package has never heard of — with nothing here to update. Only nodes are
 * reported, but the descent is unconditional, so an expression parked on a
 * shape that carries no `kind` of its own (a `Parameter`, a `MatchCase`) is
 * still reached through it.
 *
 * A pass that must not *miss* something walks with this instead of writing a
 * second switch over the node kinds it happens to remember. A-010: dependency
 * discovery kept such a switch, and `try`, `using`, `test "…":`, class
 * getters, `@dispose:` and `@iterate:` were all outside the module graph —
 * `@iterate:` from the day D68 added it, because a hand-kept copy of the AST
 * starts drifting the moment the AST grows. That copy compiled, exited 0, and
 * turned a module that exists and loads into `null`.
 */
export function* astNodes(root: unknown): Generator<AstNode> {
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
      continue;
    }
    if (typeof (value as { kind?: unknown }).kind === "string") yield value as AstNode;
    const children = Object.values(value);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
}

/** `astNodes` narrowed to one node kind, so a caller keeps the node's type. */
export function* astNodesOfKind<Node extends AstNode>(root: unknown, kind: Node["kind"]): Generator<Node> {
  for (const node of astNodes(root)) if (node.kind === kind) yield node as Node;
}

export type DirectAwaitExpressionExtension = (
  expression: Expression,
  contains: (expression: Expression) => boolean,
) => boolean | undefined;

export type DirectAwaitStatementExtension = (
  statement: Statement,
  containsExpression: (expression: Expression) => boolean,
  containsBlock: (statements: readonly Statement[]) => boolean,
) => boolean | undefined;

/**
 * Whether a block awaits in its own frame. A nested function or arrow owns its
 * awaits, so the walk stops at every declaration boundary. D43 item 69 uses
 * this to decide whether releasing a `@dispose` value needs an async scope.
 */
export function blockContainsDirectAwait(
  statements: readonly Statement[],
  expressionExtension: DirectAwaitExpressionExtension = () => undefined,
  statementExtension: DirectAwaitStatementExtension = () => undefined,
): boolean {
  return statements.some((statement) => statementContainsDirectAwait(statement, expressionExtension, statementExtension));
}

export function statementContainsDirectAwait(
  statement: Statement,
  expressionExtension: DirectAwaitExpressionExtension = () => undefined,
  statementExtension: DirectAwaitStatementExtension = () => undefined,
): boolean {
  const expression = (value: Expression): boolean => expressionContainsDirectAwait(value, expressionExtension);
  const block = (values: readonly Statement[]): boolean => blockContainsDirectAwait(values, expressionExtension, statementExtension);
  if (statement.kind.startsWith("ExtensionStatement:")) {
    const result = statementExtension(statement, expression, block);
    if (result !== undefined) return result;
    throw new Error(`Direct-await traversal has no owner for extension statement '${statement.kind}'`);
  }
  const core = statement as CoreStatement;
  switch (core.kind) {
    case "VariableDeclaration":
      return expression(core.initializer);
    case "UsingDeclaration":
      return expression(core.initializer);
    case "TestDeclaration":
      // A test body is its own async frame.
      return false;
    case "MainBlock":
      // `@main` 仍处于入口模块自己的执行帧，正文中的 await 是直接 await。
      return block(core.body);
    case "ReturnStatement":
      return core.value !== null && expression(core.value);
    case "ThrowStatement":
      return expression(core.value);
    case "AssertStatement":
      return expression(core.condition) || (core.message !== null && expression(core.message));
    case "IfStatement":
      return expression(core.condition) || block(core.thenBody) || (core.elseBody !== null && block(core.elseBody));
    case "MatchStatement":
      return expression(core.value)
        || core.cases.some((branch) => (branch.guard !== null && expression(branch.guard)) || block(branch.body));
    case "ForStatement":
      // An `async for` awaits its own pulls even when the body does not.
      return core.asynchronous || expression(core.iterable) || block(core.body);
    case "WhileStatement":
      return expression(core.condition) || block(core.body);
    case "TryStatement":
      return block(core.tryBody)
        || (core.catchBody !== null && block(core.catchBody))
        || (core.finallyBody !== null && block(core.finallyBody));
    case "AssignmentStatement":
      return expression(core.target) || expression(core.value);
    case "ExpressionStatement":
      return expression(core.expression);
    case "DetachStatement":
      // Detached execution does not wait, so it never makes its frame async.
      return false;
    case "ImportDeclaration":
    case "ReExportDeclaration":
    case "ExternModuleDeclaration":
    case "EmbeddedJavaScriptDeclaration":
    case "TypeDeclaration":
    case "TypeAliasDeclaration":
    case "EnumDeclaration":
    case "ClassDeclaration":
    case "FunctionDeclaration":
    case "BreakStatement":
    case "ContinueStatement":
    case "PassStatement":
      // Declarations either carry no runtime expression or establish their own
      // execution frame. Control-only statements cannot await.
      return false;
  }
}

export function expressionContainsDirectAwait(
  expression: Expression,
  extension: DirectAwaitExpressionExtension = () => undefined,
): boolean {
  const contains = (value: Expression): boolean => expressionContainsDirectAwait(value, extension);
  const extensionResult = extension(expression, contains);
  if (extensionResult !== undefined) return extensionResult;
  if (expression.kind.startsWith("ExtensionExpression:") && expression.kind !== "ExtensionExpression:core:duration") {
    throw new Error(`Direct-await traversal has no owner for extension expression '${expression.kind}'`);
  }
  const core = expression as CoreExpression;
  switch (core.kind) {
    case "UnaryExpression":
      return core.operator === "await" || contains(core.operand);
    case "TryExpression":
      // The wrapper is emitted as an async immediately-invoked function only
      // when its own body awaits, and that await belongs to the frame around
      // it either way.
      return contains(core.value);
    case "RequiredExpression":
      return contains(core.value);
    case "FStringExpression":
      return core.parts.some((part) => part.kind === "expression" && contains(part.value));
    case "ListExpression":
      return core.elements.some(contains);
    case "ObjectExpression":
      return core.properties.some((property) => contains(property.value));
    case "SpreadExpression":
      return contains(core.value);
    case "BinaryExpression":
      return contains(core.left) || contains(core.right);
    case "AssignmentExpression":
      return contains(core.target) || contains(core.value);
    case "ComparisonChainExpression":
      return core.operands.some(contains);
    case "ConditionalExpression":
      return contains(core.condition) || contains(core.thenValue) || contains(core.elseValue);
    case "IsExpression":
      return contains(core.value);
    case "CallExpression":
      return contains(core.callee) || core.arguments.some(contains);
    case "MemberExpression":
      return contains(core.object);
    case "IndexExpression":
      return contains(core.object) || contains(core.index);
    case "ArrowFunctionExpression":
    case "DynamicImportExpression":
    case "ExtensionExpression:core:duration":
    case "LiteralExpression":
    case "IdentifierExpression":
    case "SuperExpression":
      return false;
  }
}
