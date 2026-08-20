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
  | EmbeddedJavaScriptDeclaration
  | TypeDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration
  | ClassDeclaration
  | VariableDeclaration
  | UsingDeclaration
  | TestDeclaration
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
 * D56 rule 129 — every statement form Core's grammar produces, keyed by the
 * node kind the parser returns for it. The string is prose for a failure
 * message; the *keys* are the data.
 *
 * The mapped type is both the derivation and the enforcement: a member added
 * to `CoreStatement` above makes this object stop typechecking until its
 * spelling is written here, so the roster cannot fall behind the union the
 * parser returns. That is the whole reason it lives beside the union instead
 * of in a gate script — D57 rule 134's failure family is the hand-kept copy,
 * and a copy that `tsc` refuses to accept as incomplete is not one.
 *
 * The tour-coverage gate requires every key to be parsed out of
 * `examples/tour/`, and this is the one category of that gate that names a
 * *construct* rather than a *name*. It exists because names were not enough:
 * `extern`, `js`, and `unsafe` were already covered as keywords by chapter 13's
 * `extern module` and `import js unsafe`, so D53 rule 117's two inline blocks —
 * spelled entirely out of keywords the tour already exercised — landed with no
 * tour example at all and the gate stayed green.
 *
 * A node kind that deliberately carries multiple grammar forms contributes a
 * projected key for each form. The AST keeps its semantic fields instead of
 * acquiring redundant tags solely for coverage; this function is the one
 * compiler-owned projection the tour gate reads.
 */
export type CoreStatementConstructKey = Exclude<
  CoreStatement,
  EmbeddedJavaScriptDeclaration | VariableDeclaration | FunctionDeclaration | ClassDeclaration | ForStatement
>["kind"]
  | "EmbeddedJavaScriptDeclaration:checked"
  | "EmbeddedJavaScriptDeclaration:unsafe"
  | `VariableDeclaration:${VariableDeclaration["binding"]}`
  | `FunctionDeclaration:${"def" | "async-def"}`
  | `ClassDeclaration:${"class" | "abstract-class"}`
  | `ForStatement:${"for" | "async-for"}`;

export const CORE_STATEMENT_CONSTRUCTS = Object.freeze({
  ImportDeclaration: 'import {name} from "./module.vel"',
  ReExportDeclaration: 'export {name} from "./module.vel"',
  ExternModuleDeclaration: 'extern module "node:crypto":',
  "EmbeddedJavaScriptDeclaration:checked": "extern js(capture: T)`…`:",
  "EmbeddedJavaScriptDeclaration:unsafe": "unsafe js`…`",
  TypeDeclaration: "type Name:",
  TypeAliasDeclaration: "type Name = string",
  EnumDeclaration: "enum Name:",
  "ClassDeclaration:class": "class Name:",
  "ClassDeclaration:abstract-class": "abstract class Name:",
  "VariableDeclaration:const": "const name = value",
  "VariableDeclaration:let": "let name = value",
  UsingDeclaration: "using name = open(path)",
  TestDeclaration: 'test "a name":',
  "FunctionDeclaration:def": "def name() -> T:",
  "FunctionDeclaration:async-def": "async def name() -> T:",
  ReturnStatement: "return value",
  ThrowStatement: "throw error",
  AssertStatement: "assert condition",
  IfStatement: "if condition:",
  MatchStatement: "match value:",
  "ForStatement:for": "for item in values:",
  "ForStatement:async-for": "async for item in values:",
  WhileStatement: "while condition:",
  BreakStatement: "break",
  ContinueStatement: "continue",
  TryStatement: "try:",
  PassStatement: "pass",
  AssignmentStatement: "name = value",
  ExpressionStatement: "call()",
  AsyncStatement: "async call()",
} satisfies { readonly [Kind in CoreStatementConstructKey]: string });

/** The tour key for one Core statement, including every multi-form projection. */
export function coreStatementConstructKey(statement: CoreStatement): CoreStatementConstructKey {
  switch (statement.kind) {
    case "EmbeddedJavaScriptDeclaration":
      return `EmbeddedJavaScriptDeclaration:${statement.form}`;
    case "VariableDeclaration":
      return `VariableDeclaration:${statement.binding}`;
    case "FunctionDeclaration":
      return `FunctionDeclaration:${statement.asynchronous ? "async-def" : "def"}`;
    case "ClassDeclaration":
      return `ClassDeclaration:${statement.abstract ? "abstract-class" : "class"}`;
    case "ForStatement":
      return `ForStatement:${statement.asynchronous ? "async-for" : "for"}`;
    default:
      return statement.kind;
  }
}

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
  /** A checked non-code package or project resource imported as a value. */
  readonly resource?: "json";
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

/** The declaration-shaped half shared by external-module and embedded-JS contracts. */
export interface ExternModuleContract {
  readonly functions: readonly ExternFunctionDeclaration[];
  readonly constants: readonly ExternConstantDeclaration[];
  readonly classes: readonly ExternClassDeclaration[];
  readonly span: Span;
}

/** D53 rule 117: one Core-owned raw JavaScript module embedded in a `.vel` module. */
interface EmbeddedJavaScriptDeclarationBase {
  readonly kind: "EmbeddedJavaScriptDeclaration";
  /** Checked blocks receive these values as real synchronous factory parameters. */
  readonly captures: readonly EmbeddedJavaScriptCapture[];
  /** Exact, contiguous source slice: `source[i] === moduleText[sourceSpan.start + i]`. */
  readonly source: string;
  readonly sourceSpan: Span;
  /** Every statically named ESM export and the local binding that supplies it. */
  readonly exports: readonly EmbeddedJavaScriptExport[];
  /** Imports stay at sibling-module top level when a checked block becomes a factory. */
  readonly imports: readonly EmbeddedJavaScriptImport[];
  /** Literal ESM sources the project resolver must validate before emission. */
  readonly dependencies: readonly EmbeddedJavaScriptDependency[];
  /** All module-level JS bindings; capture parameters may not shadow them. */
  readonly bindings: readonly EmbeddedJavaScriptBinding[];
  /** Acorn-derived source edits; no JavaScript is rediscovered with text matching. */
  readonly factoryEdits: readonly EmbeddedJavaScriptFactoryEdit[];
  readonly span: Span;
}

export interface CheckedEmbeddedJavaScriptDeclaration extends EmbeddedJavaScriptDeclarationBase {
  readonly form: "checked";
  readonly unsafe: false;
  readonly contract: ExternModuleContract;
}

export interface UnsafeEmbeddedJavaScriptDeclaration extends EmbeddedJavaScriptDeclarationBase {
  readonly form: "unsafe";
  readonly unsafe: true;
  readonly contract: null;
}

export type EmbeddedJavaScriptDeclaration = CheckedEmbeddedJavaScriptDeclaration | UnsafeEmbeddedJavaScriptDeclaration;

export interface EmbeddedJavaScriptCapture {
  readonly name: string;
  readonly nameSpan: Span;
  readonly type: TypeReference;
  readonly span: Span;
}

export interface EmbeddedJavaScriptExport {
  readonly name: string;
  readonly nameSpan: Span;
  readonly local: string;
  readonly localSpan: Span;
}

export interface EmbeddedJavaScriptImport {
  readonly span: Span;
}

export interface EmbeddedJavaScriptDependency {
  readonly source: string;
  readonly span: Span;
  readonly dynamic: boolean;
}

export interface EmbeddedJavaScriptBinding {
  readonly name: string;
  readonly nameSpan: Span;
}

export interface EmbeddedJavaScriptFactoryEdit {
  readonly span: Span;
  readonly replacement: string;
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
  /** D55 rule 120: `type Box<T>` / `type Box<T: Data>`, the same list `def` takes. */
  readonly typeParameters?: readonly TypeParameterDeclaration[];
  /** One concrete record base. Inheritance extends the field contract; it has no runtime prototype semantics. */
  readonly base: TypeReference | null;
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
  /** The compiler-owned `@dispose:` release contract, if declared. */
  readonly dispose: ClassDisposeBlock | null;
  /** The compiler-owned `@iterate:` iteration contract, if declared. */
  readonly iterate: ClassIterateBlock | null;
  readonly span: Span;
}

/**
 * `@dispose:` is a compiler-owned contextual role, not a method. It
 * cannot be called from source — it is the ownership contract `using` runs, and
 * a second spelling of `close()` is exactly what it exists to avoid.
 */
export interface ClassDisposeBlock {
  readonly kind: "ClassDisposeBlock";
  readonly body: readonly Statement[];
  readonly keywordSpan: Span;
  readonly span: Span;
}

/**
 * `@iterate:` is the second compiler-owned class role, and it
 * carries `@dispose:`'s shape for the same reason — it is a question the
 * language asks the type ("what does iterating you mean?"), not a method the
 * author publishes, so it cannot be called from source either. It answers with
 * a List, Set, Map, or Record the language already knows how to iterate; no
 * iterator protocol enters the language (charter section 19 stands).
 */
export interface ClassIterateBlock {
  readonly kind: "ClassIterateBlock";
  readonly body: readonly Statement[];
  readonly keywordSpan: Span;
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

/**
 * D43 item 69: `using name = expression` takes ownership of a resource for the
 * enclosing scope. The binding is const, and every exit from the scope —
 * normal, `return`, `break`, `continue`, or a throw — releases it through its
 * type's `@dispose` contract, in reverse declaration order.
 */
export interface UsingDeclaration {
  readonly kind: "UsingDeclaration";
  readonly name: string;
  readonly nameSpan: Span;
  readonly initializer: Expression;
  readonly span: Span;
}

/**
 * D39 item 53: `test "name":` declares one test. The name is a string literal
 * the reporter quotes verbatim, because a test is the product specification a
 * human reads, not a machine-shaped function name.
 */
export interface TestDeclaration {
  readonly kind: "TestDeclaration";
  readonly title: string;
  readonly titleSpan: Span;
  readonly body: readonly Statement[];
  readonly span: Span;
}

/** The generated function name a `test "name":` block emits and the runner calls. */
export function testFunctionName(statement: TestDeclaration): string {
  return `__velarTest${statement.span.start}`;
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
  /**
   * The written result annotation together with the `->` and the space before
   * it — exactly the text a deletion removes, running from the end of the
   * parameter list to the end of the annotation. Present only where a result
   * was written after a parameter list, which is what makes the D58 rule 139
   * removal of an inferred `-> null` a mechanical fix.
   */
  readonly resultAnnotationSpan?: Span;
  readonly signatureSpan: Span;
  readonly body: readonly Statement[];
  readonly span: Span;
}

export interface TypeParameterDeclaration {
  readonly name: string;
  /** The bound written as `<T: Text>`; always a name from the closed vocabulary. */
  readonly bound?: string;
  readonly boundSpan?: Span;
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
  readonly operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "|=" | "&=" | "^=" | "<<=" | ">>=" | ">>>=";
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

/** D79 rule 199: Core's duration literal is a declared AST node, not a cast. */
export interface CoreDurationExpression {
  readonly kind: "ExtensionExpression:core:duration";
  readonly value: number;
  readonly unit: "ms" | "s";
  readonly raw: string;
  readonly span: Span;
}

/** D82 rule 203: a mapped roster makes every Core expression kind explicit. */
export const CORE_EXPRESSION_CONSTRUCTS = Object.freeze({
  LiteralExpression: "literal",
  FStringExpression: "f-string",
  IdentifierExpression: "name",
  SuperExpression: "super",
  DynamicImportExpression: "import(\"./module.vel\")",
  ListExpression: "[value]",
  ObjectExpression: "{field: value}",
  SpreadExpression: "...value",
  UnaryExpression: "not value — or await value",
  TryExpression: "try value",
  BinaryExpression: "left + right",
  AssignmentExpression: "recovery node for assignment in expression position",
  ComparisonChainExpression: "minimum <= value < maximum",
  ConditionalExpression: "value if condition else fallback",
  IsExpression: "value is Type",
  ArrowFunctionExpression: "value => result",
  CallExpression: "call()",
  MemberExpression: "value.member",
  IndexExpression: "value[index]",
  "ExtensionExpression:core:duration": "250ms",
} satisfies { readonly [Kind in CoreExpression["kind"]]: string });

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
  /** Written as `{name}`: the field name and the binding it reads are one word. */
  readonly shorthand?: boolean;
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
  readonly operator: "not" | "+" | "-" | "~" | "await";
  readonly operand: Expression;
  readonly span: Span;
}

/**
 * D39 item 51: `try <postfix-expression>` turns an expected failure into
 * `null`. It carries the same reach as `await` — the whole postfix chain — and
 * its result must be consumed, so a swallowed failure is always visible where
 * it is handled.
 */
export interface TryExpression {
  readonly kind: "TryExpression";
  readonly value: Expression;
  readonly span: Span;
}

export interface BinaryExpression {
  readonly kind: "BinaryExpression";
  readonly left: Expression;
  readonly operator: "??" | "or" | "and" | "in" | "not in" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "|" | "^" | "&" | "<<" | ">>" | ">>>" | "+" | "-" | "*" | "**" | "/" | "%";
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
  readonly operator: AssignmentStatement["operator"];
  readonly value: Expression;
  readonly span: Span;
}

export interface ComparisonChainExpression {
  readonly kind: "ComparisonChainExpression";
  readonly operands: readonly Expression[];
  readonly operators: readonly ("==" | "!=" | "<" | "<=" | ">" | ">=")[];
  readonly parenthesized?: true;
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
  readonly parenthesized?: true;
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
  /**
   * The call was written with explicit type arguments, which VEL2031 removed
   * as it recovered. The author did name the types, so a later rule that
   * reports a missing one stays quiet rather than reporting the same mistake
   * a second time.
   */
  readonly typeArgumentsRemoved?: boolean;
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

/** Anything the AST puts a `kind` on: a node, a pattern, an f-string part. */
export interface AstNode {
  readonly kind: string;
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
    case "AsyncStatement":
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
