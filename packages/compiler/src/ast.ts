/**
 * The Core AST's front door. `ast.ts` was one 1,410-line module holding every
 * node interface, both construct rosters and every walk helper; D115 §三 split
 * it into `ast/` by what each part is, and this facade re-exports all 136 names
 * it published, so no import path in the repository changed.
 *
 * Where to look:
 *
 *  - `ast/nodes/base.ts`        the module root, the statement and expression
 *                               unions, the opaque extension nodes, `Parameter`,
 *                               and `AstNode` — the leaf the others read
 *  - `ast/nodes/statements.ts`  every statement node and the shapes one of them
 *                               alone owns (specifiers, `extern` contracts,
 *                               class members, match cases)
 *  - `ast/nodes/expressions.ts` every expression node, and the unions written
 *                               entirely out of them
 *  - `ast/nodes/types.ts`       written type syntax and the type-parameter list
 *  - `ast/nodes/patterns.ts`    binding patterns and match patterns
 *  - `ast/constructs.ts`        the statement and expression construct rosters,
 *                               each a mapped type over its union
 *  - `ast/walk.ts`              the readers: the structural walk, the two
 *                               questions asked about a statement, the module's
 *                               startup code, and the direct-await traversal
 */
export type {
  AstNode, ContextMarker, CoreExpression, CoreStatement, Expression, ExtensionExpression, ExtensionStatement,
  Parameter, Program, Statement,
} from "./ast/nodes/base.ts";
export type {
  AssertStatement, AssignmentStatement, BreakStatement, CheckedEmbeddedJavaScriptDeclaration, ClassBase,
  ClassDeclaration, ClassDisposeBlock, ClassFieldDeclaration, ClassGetterDeclaration, ClassInitBlock,
  ClassIterateBlock, ClassMethodDeclaration, ClassParameter, ContinueStatement, DetachStatement,
  EmbeddedJavaScriptBinding, EmbeddedJavaScriptCapture, EmbeddedJavaScriptDeclaration,
  EmbeddedJavaScriptDependency, EmbeddedJavaScriptExport, EmbeddedJavaScriptFactoryEdit,
  EmbeddedJavaScriptImport, EnumDeclaration, EnumMember, ExpressionStatement, ExternClassDeclaration,
  ExternClassFieldDeclaration, ExternClassGetterDeclaration, ExternClassMethodDeclaration,
  ExternConstantDeclaration, ExternFunctionDeclaration, ExternModuleContract, ExternModuleDeclaration,
  ForStatement, FunctionDeclaration, IfStatement, ImportDeclaration, ImportSpecifier, MainBlock, MatchCase,
  MatchStatement, PassStatement, ReExportDeclaration, ReExportSpecifier, ReturnStatement, TestDeclaration,
  ThrowStatement, TryStatement, TypeAliasDeclaration, TypeDeclaration, TypeField,
  UnsafeEmbeddedJavaScriptDeclaration, UsingDeclaration, VariableDeclaration, WhileStatement,
} from "./ast/nodes/statements.ts";
export type {
  ArrowFunctionExpression, AssignmentExpression, AssignmentTarget, BinaryExpression, CallExpression,
  ComparisonChainExpression, ConditionalExpression, CoreDurationExpression, DynamicImportExpression,
  FStringExpression, FStringPart, IdentifierExpression, IndexExpression, IsExpression, ListExpression,
  LiteralExpression, MemberExpression, ObjectEntry, ObjectExpression, ObjectProperty, ObjectSpread,
  RequiredExpression, SpreadExpression, SuperExpression, TryExpression, UnaryExpression,
} from "./ast/nodes/expressions.ts";
export type {
  EnumMemberTypeSyntax, FunctionTypeParameterSyntax, FunctionTypeSyntax, GenericTypeSyntax, NamedTypeSyntax,
  OptionalTypeSyntax, ReadonlyTypeSyntax, TypeNameSegment, TypeParameterDeclaration, TypeReference, TypeSyntax,
  UnionTypeSyntax,
} from "./ast/nodes/types.ts";
export type {
  BindingPattern, ListBindingPattern, MatchAsPattern, MatchBinding, MatchCapturePattern, MatchListPattern,
  MatchObjectEntry, MatchObjectPattern, MatchPattern, MatchTypePattern, MatchValue, MatchValuePattern,
  MatchWildcardPattern, NameBindingPattern, ObjectBindingEntry, ObjectBindingPattern,
} from "./ast/nodes/patterns.ts";
export { CORE_EXPRESSION_CONSTRUCTS, CORE_STATEMENT_CONSTRUCTS, coreStatementConstructKey } from "./ast/constructs.ts";
export type { CoreStatementConstructKey } from "./ast/constructs.ts";
export {
  astNodes, astNodesOfKind, blockContainsDirectAwait, expressionContainsDirectAwait, isModuleDeclarationStatement,
  moduleStartupCode, statementContainsDirectAwait, statementOwnsBlock, testFunctionName,
} from "./ast/walk.ts";
export type {
  DirectAwaitExpressionExtension, DirectAwaitStatementExtension, ModuleStartupCode, ModuleStartupStatement,
} from "./ast/walk.ts";
