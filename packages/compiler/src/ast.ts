import type { Span } from "./source.ts";

export interface Program {
  readonly kind: "Program";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export type CoreStatement =
  | ImportDeclaration
  | ReExportDeclaration
  | ExternModuleDeclaration
  | TypeDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration
  | ClassDeclaration
  | VariableDeclaration
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
  | AsyncStatement;

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

export interface ImportDeclaration {
  readonly kind: "ImportDeclaration";
  readonly source: string;
  readonly sourceSpan: Span;
  readonly javascript: boolean;
  readonly unsafe: boolean;
  readonly specifiers: readonly ImportSpecifier[];
  readonly span: Span;
}

export interface ImportSpecifier {
  readonly imported: string;
  readonly local: string;
  readonly namespace: boolean;
  readonly span: Span;
}

export interface ReExportDeclaration {
  readonly kind: "ReExportDeclaration";
  readonly source: string;
  readonly sourceSpan: Span;
  readonly specifiers: readonly ReExportSpecifier[];
  readonly span: Span;
}

export interface ReExportSpecifier {
  readonly imported: string;
  readonly exported: string;
  readonly span: Span;
}

export interface ExternModuleDeclaration {
  readonly kind: "ExternModuleDeclaration";
  readonly source: string;
  readonly functions: readonly ExternFunctionDeclaration[];
  readonly constants: readonly ExternConstantDeclaration[];
  readonly classes: readonly ExternClassDeclaration[];
  readonly span: Span;
}

export interface ExternFunctionDeclaration {
  readonly asynchronous: boolean;
  readonly name: string;
  readonly typeParameters?: readonly TypeParameterDeclaration[];
  readonly parameters: readonly Parameter[];
  readonly returnType: TypeReference | null;
  readonly signatureSpan: Span;
  readonly span: Span;
}

export interface ExternConstantDeclaration {
  readonly name: string;
  readonly type: TypeReference;
  readonly span: Span;
}

export interface ExternClassDeclaration {
  readonly name: string;
  readonly parameters: readonly ClassParameter[];
  readonly base: string | null;
  readonly fields: readonly ExternClassFieldDeclaration[];
  readonly getters: readonly ExternClassGetterDeclaration[];
  readonly methods: readonly ExternClassMethodDeclaration[];
  readonly span: Span;
}

export interface ExternClassFieldDeclaration {
  readonly static: boolean;
  readonly mutable: boolean;
  readonly name: string;
  readonly type: TypeReference;
  readonly span: Span;
}

export interface ExternClassMethodDeclaration extends ExternFunctionDeclaration {
  readonly static: boolean;
}

export interface ExternClassGetterDeclaration {
  readonly static: boolean;
  readonly name: string;
  readonly type: TypeReference;
  readonly span: Span;
}

export interface AssertStatement {
  readonly kind: "AssertStatement";
  readonly condition: Expression;
  readonly message: Expression | null;
  readonly span: Span;
}

export interface TypeDeclaration {
  readonly kind: "TypeDeclaration";
  readonly exported: boolean;
  readonly name: string;
  readonly fields: readonly TypeField[];
  readonly span: Span;
}

export interface TypeAliasDeclaration {
  readonly kind: "TypeAliasDeclaration";
  readonly exported: boolean;
  readonly name: string;
  readonly target: TypeReference;
  readonly span: Span;
}

export interface TypeField {
  readonly readonly: boolean;
  readonly name: string;
  readonly type: TypeReference;
  readonly span: Span;
}

export interface EnumDeclaration {
  readonly kind: "EnumDeclaration";
  readonly exported: boolean;
  readonly name: string;
  readonly members: readonly EnumMember[];
  readonly span: Span;
}

export interface EnumMember {
  readonly name: string;
  /** Runtime string value. Defaults to `name` when no explicit value is written. */
  readonly value: string;
  readonly valueSpan?: Span;
  readonly span: Span;
}

export interface ClassDeclaration {
  readonly kind: "ClassDeclaration";
  readonly exported: boolean;
  readonly abstract: boolean;
  readonly name: string;
  readonly parameters: readonly ClassParameter[];
  readonly base: ClassBase | null;
  readonly fields: readonly ClassFieldDeclaration[];
  readonly initialization: ClassInitBlock | null;
  readonly getters: readonly ClassGetterDeclaration[];
  readonly methods: readonly ClassMethodDeclaration[];
  readonly span: Span;
}

export interface ClassInitBlock {
  readonly kind: "ClassInitBlock";
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface ClassBase {
  readonly name: string;
  readonly arguments: readonly Expression[];
  readonly span: Span;
}

export interface ClassMethodDeclaration extends FunctionDeclaration {
  readonly abstract: boolean;
  readonly override: boolean;
  readonly static: boolean;
  readonly private: boolean;
}

export interface ClassGetterDeclaration extends FunctionDeclaration {
  readonly accessor: true;
  readonly abstract: boolean;
  readonly override: boolean;
  readonly static: boolean;
  readonly private: boolean;
}

export interface ClassFieldDeclaration {
  readonly binding: "const" | "let";
  readonly static: boolean;
  readonly private: boolean;
  readonly name: string;
  readonly type: TypeReference;
  readonly initializer: Expression | null;
  readonly span: Span;
}

export interface ClassParameter extends Parameter {
  readonly binding: "const" | "let" | null;
  readonly private: boolean;
}

export interface VariableDeclaration {
  readonly kind: "VariableDeclaration";
  readonly binding: "const" | "let";
  readonly exported: boolean;
  readonly pattern: BindingPattern;
  readonly type: TypeReference | null;
  readonly initializer: Expression;
  readonly span: Span;
}

export type BindingPattern = NameBindingPattern | ObjectBindingPattern | ListBindingPattern;

export interface NameBindingPattern {
  readonly kind: "NameBindingPattern";
  readonly name: string;
  readonly span: Span;
}

export interface ObjectBindingPattern {
  readonly kind: "ObjectBindingPattern";
  readonly entries: readonly ObjectBindingEntry[];
  readonly rest: NameBindingPattern | null;
  readonly span: Span;
}

export interface ObjectBindingEntry {
  readonly property: string;
  readonly pattern: BindingPattern;
  readonly span: Span;
}

export interface ListBindingPattern {
  readonly kind: "ListBindingPattern";
  readonly elements: readonly (BindingPattern | null)[];
  readonly rest: NameBindingPattern | null;
  readonly span: Span;
}

export interface FunctionDeclaration {
  readonly kind: "FunctionDeclaration";
  readonly exported: boolean;
  readonly asynchronous: boolean;
  readonly name: string;
  readonly typeParameters?: readonly TypeParameterDeclaration[];
  readonly parameters: readonly Parameter[];
  readonly returnType: TypeReference | null;
  readonly signatureSpan: Span;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface TypeParameterDeclaration {
  readonly name: string;
  readonly span: Span;
}

export interface Parameter {
  readonly name: string;
  readonly type: TypeReference | null;
  readonly defaultValue: Expression | null;
  readonly rest: boolean;
  readonly span: Span;
}

export interface TypeReference {
  readonly syntax: TypeSyntax;
  readonly span: Span;
}

export type TypeSyntax = NamedTypeSyntax | EnumMemberTypeSyntax | GenericTypeSyntax | ReadonlyTypeSyntax | OptionalTypeSyntax | UnionTypeSyntax | FunctionTypeSyntax;

export interface NamedTypeSyntax {
  readonly kind: "NamedTypeSyntax";
  readonly name: string;
  readonly span: Span;
}

export interface EnumMemberTypeSyntax {
  readonly kind: "EnumMemberTypeSyntax";
  readonly enumName: string;
  readonly enumNameSpan: Span;
  readonly member: string;
  readonly memberSpan: Span;
  readonly span: Span;
}

export interface GenericTypeSyntax {
  readonly kind: "GenericTypeSyntax";
  readonly name: string;
  readonly nameSpan: Span;
  readonly arguments: readonly TypeSyntax[];
  readonly span: Span;
}

export interface ReadonlyTypeSyntax {
  readonly kind: "ReadonlyTypeSyntax";
  readonly inner: TypeSyntax;
  readonly span: Span;
}

export interface OptionalTypeSyntax {
  readonly kind: "OptionalTypeSyntax";
  readonly inner: TypeSyntax;
  readonly span: Span;
}

export interface UnionTypeSyntax {
  readonly kind: "UnionTypeSyntax";
  readonly members: readonly TypeSyntax[];
  readonly span: Span;
}

export interface FunctionTypeSyntax {
  readonly kind: "FunctionTypeSyntax";
  readonly parameters: readonly FunctionTypeParameterSyntax[];
  readonly result: TypeSyntax;
  readonly span: Span;
}

export interface FunctionTypeParameterSyntax {
  readonly name: string | null;
  readonly type: TypeSyntax;
  readonly rest: boolean;
  readonly optional: boolean;
  readonly span: Span;
}

export interface ReturnStatement {
  readonly kind: "ReturnStatement";
  readonly value: Expression | null;
  readonly span: Span;
}

export interface ThrowStatement {
  readonly kind: "ThrowStatement";
  readonly value: Expression;
  readonly span: Span;
}

export interface IfStatement {
  readonly kind: "IfStatement";
  readonly condition: Expression;
  readonly thenBody: readonly Statement[];
  readonly elseBody: readonly Statement[] | null;
  readonly span: Span;
}

export interface MatchStatement {
  readonly kind: "MatchStatement";
  readonly value: Expression;
  readonly cases: readonly MatchCase[];
  readonly span: Span;
}

export interface MatchCase {
  readonly pattern: MatchPattern;
  readonly guard: Expression | null;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export type MatchPattern =
  | MatchValuePattern
  | MatchTypePattern
  | MatchObjectPattern
  | MatchListPattern
  | MatchWildcardPattern
  | MatchCapturePattern
  | MatchAsPattern;

export interface MatchValuePattern {
  readonly kind: "MatchValuePattern";
  readonly values: readonly MatchValue[];
  readonly span: Span;
}

export interface MatchTypePattern {
  readonly kind: "MatchTypePattern";
  readonly type: TypeReference;
  readonly span: Span;
}

export interface MatchObjectPattern {
  readonly kind: "MatchObjectPattern";
  readonly entries: readonly MatchObjectEntry[];
  readonly rest: MatchBinding | null;
  readonly span: Span;
}

export interface MatchObjectEntry {
  readonly property: string;
  readonly pattern: MatchPattern;
  readonly span: Span;
}

export interface MatchListPattern {
  readonly kind: "MatchListPattern";
  readonly elements: readonly MatchPattern[];
  readonly rest: MatchBinding | null;
  readonly span: Span;
}

export interface MatchWildcardPattern {
  readonly kind: "MatchWildcardPattern";
  readonly span: Span;
}

export interface MatchCapturePattern {
  readonly kind: "MatchCapturePattern";
  readonly binding: MatchBinding;
  readonly span: Span;
}

export interface MatchAsPattern {
  readonly kind: "MatchAsPattern";
  readonly pattern: MatchPattern;
  readonly binding: MatchBinding;
  readonly span: Span;
}

export interface MatchBinding {
  readonly name: string;
  readonly span: Span;
}

export type MatchValue = LiteralExpression | MemberExpression;

export interface ForStatement {
  readonly kind: "ForStatement";
  readonly asynchronous: boolean;
  readonly pattern: BindingPattern;
  readonly secondPattern: BindingPattern | null;
  readonly iterable: Expression;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface WhileStatement {
  readonly kind: "WhileStatement";
  readonly condition: Expression;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface BreakStatement {
  readonly kind: "BreakStatement";
  readonly span: Span;
}

export interface ContinueStatement {
  readonly kind: "ContinueStatement";
  readonly span: Span;
}

export interface TryStatement {
  readonly kind: "TryStatement";
  readonly tryBody: readonly Statement[];
  readonly catchName: string | null;
  readonly catchBody: readonly Statement[] | null;
  readonly finallyBody: readonly Statement[] | null;
  readonly span: Span;
}

export interface PassStatement {
  readonly kind: "PassStatement";
  readonly span: Span;
}

export interface AssignmentStatement {
  readonly kind: "AssignmentStatement";
  readonly target: AssignmentTarget;
  readonly operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=";
  readonly value: Expression;
  readonly span: Span;
}

export type AssignmentTarget = IdentifierExpression | MemberExpression | IndexExpression;

export interface ExpressionStatement {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
  readonly span: Span;
}

/**
 * `async <expression>` runs a `Promise<null>` expression detached: the
 * statement does not wait, and the emitter hands the Promise to a
 * compiler-owned observer that reports rejection through the host error
 * channel instead of letting it float.
 */
export interface AsyncStatement {
  readonly kind: "AsyncStatement";
  readonly expression: Expression;
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
  | BinaryExpression
  | AssignmentExpression
  | ComparisonChainExpression
  | ConditionalExpression
  | IsExpression
  | ArrowFunctionExpression
  | CallExpression
  | MemberExpression
  | IndexExpression;

export type Expression = CoreExpression | ExtensionExpression;

/** See ExtensionStatement. */
export interface ExtensionExpression {
  readonly kind: `ExtensionExpression:${string}`;
  readonly span: Span;
}

export interface LiteralExpression {
  readonly kind: "LiteralExpression";
  readonly value: string | number | boolean | null;
  readonly raw: string;
  readonly span: Span;
}

export interface FStringExpression {
  readonly kind: "FStringExpression";
  readonly parts: readonly FStringPart[];
  readonly span: Span;
}

export type FStringPart =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "expression"; readonly value: Expression };

export interface IdentifierExpression {
  readonly kind: "IdentifierExpression";
  readonly name: string;
  readonly span: Span;
}

export interface SuperExpression {
  readonly kind: "SuperExpression";
  readonly span: Span;
}

export interface DynamicImportExpression {
  readonly kind: "DynamicImportExpression";
  readonly source: string;
  readonly sourceSpan: Span;
  readonly span: Span;
}

export interface ListExpression {
  readonly kind: "ListExpression";
  readonly elements: readonly Expression[];
  readonly span: Span;
}

export interface ObjectExpression {
  readonly kind: "ObjectExpression";
  readonly properties: readonly ObjectEntry[];
  readonly span: Span;
}

export type ObjectEntry = ObjectProperty | ObjectSpread;

export interface ObjectProperty {
  readonly kind: "ObjectProperty";
  readonly name: string;
  readonly value: Expression;
  readonly span: Span;
}

export interface ObjectSpread {
  readonly kind: "ObjectSpread";
  readonly value: Expression;
  readonly span: Span;
}

export interface SpreadExpression {
  readonly kind: "SpreadExpression";
  readonly value: Expression;
  readonly span: Span;
}

export interface UnaryExpression {
  readonly kind: "UnaryExpression";
  readonly operator: "not" | "+" | "-" | "await";
  readonly operand: Expression;
  readonly span: Span;
}

export interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly left: Expression;
  readonly operator: "??" | "or" | "and" | "in" | "not in" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "**" | "/" | "%";
  readonly right: Expression;
  /**
   * Present when the author wrote explicit parentheses around this binary
   * expression. The parser uses it to tell a deliberate grouping from a bare
   * chain when `??` mixes with `and`/`or`; emission is unaffected.
   */
  readonly parenthesized?: true;
  readonly span: Span;
}

/**
 * A parse recovery for an assignment written where an expression is required
 * (an interpolated fragment or an arrow body). The parser reports directive
 * guidance and keeps the assignment shape so later stages can add their own
 * guidance; it never reaches code generation.
 */
export interface AssignmentExpression {
  readonly kind: "AssignmentExpression";
  readonly target: Expression;
  readonly operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=";
  readonly value: Expression;
  readonly span: Span;
}

export interface ComparisonChainExpression {
  readonly kind: "ComparisonChainExpression";
  readonly operands: readonly Expression[];
  readonly operators: readonly ("==" | "!=" | "<" | "<=" | ">" | ">=")[];
  readonly span: Span;
}

export interface ConditionalExpression {
  readonly kind: "ConditionalExpression";
  readonly condition: Expression;
  readonly thenValue: Expression;
  readonly elseValue: Expression;
  readonly span: Span;
}

export interface IsExpression {
  readonly kind: "IsExpression";
  readonly value: Expression;
  readonly operator: "is" | "is not";
  readonly type: TypeReference;
  readonly span: Span;
}

export interface ArrowFunctionExpression {
  readonly kind: "ArrowFunctionExpression";
  readonly asynchronous: boolean;
  readonly parameters: readonly Parameter[];
  readonly body: Expression;
  readonly span: Span;
}

export interface CallExpression {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: readonly Expression[];
  readonly argumentNames?: readonly (string | null)[];
  readonly optional: boolean;
  readonly span: Span;
}

export interface MemberExpression {
  readonly kind: "MemberExpression";
  readonly object: Expression;
  readonly property: string;
  readonly optional: boolean;
  readonly span: Span;
}

export interface IndexExpression {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
  readonly optional: boolean;
  readonly span: Span;
}

export function expressionContainsDirectAwait(
  expression: Expression,
  extension: (value: Expression) => boolean | undefined = () => undefined,
): boolean {
  const extensionResult = extension(expression);
  if (extensionResult !== undefined) return extensionResult;
  switch (expression.kind) {
    case "UnaryExpression":
      return expression.operator === "await" || expressionContainsDirectAwait(expression.operand, extension);
    case "FStringExpression":
      return expression.parts.some((part) => part.kind === "expression" && expressionContainsDirectAwait(part.value, extension));
    case "ListExpression":
      return expression.elements.some((element) => expressionContainsDirectAwait(element, extension));
    case "ObjectExpression":
      return expression.properties.some((property) => expressionContainsDirectAwait(property.value, extension));
    case "SpreadExpression":
      return expressionContainsDirectAwait(expression.value, extension);
    case "BinaryExpression":
      return expressionContainsDirectAwait(expression.left, extension) || expressionContainsDirectAwait(expression.right, extension);
    case "AssignmentExpression":
      return expressionContainsDirectAwait(expression.target, extension) || expressionContainsDirectAwait(expression.value, extension);
    case "ComparisonChainExpression":
      return expression.operands.some((operand) => expressionContainsDirectAwait(operand, extension));
    case "ConditionalExpression":
      return expressionContainsDirectAwait(expression.condition, extension)
        || expressionContainsDirectAwait(expression.thenValue, extension)
        || expressionContainsDirectAwait(expression.elseValue, extension);
    case "IsExpression":
      return expressionContainsDirectAwait(expression.value, extension);
    case "CallExpression":
      return expressionContainsDirectAwait(expression.callee, extension)
        || expression.arguments.some((argument) => expressionContainsDirectAwait(argument, extension));
    case "MemberExpression":
      return expressionContainsDirectAwait(expression.object, extension);
    case "IndexExpression":
      return expressionContainsDirectAwait(expression.object, extension)
        || expressionContainsDirectAwait(expression.index, extension);
    case "ArrowFunctionExpression":
    case "DynamicImportExpression":
    case "LiteralExpression":
    case "IdentifierExpression":
    case "SuperExpression":
      return false;
    default:
      return false;
  }
}
