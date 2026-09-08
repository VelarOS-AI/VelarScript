/**
 * Every statement node Core's grammar produces, and the shapes that belong to
 * one of them alone — an import specifier, an `extern` contract, a class
 * member, a match case.
 *
 * The roster of these kinds, and the tour spelling of each, is
 * `ast/constructs.ts`; the union they form is `nodes/base.ts`.
 */
import type { Span } from "../../source.ts";
import type { EmbeddedJavaScriptEditorToken } from "../../embedded-javascript-editor.ts";
import type { Expression, Parameter, Statement } from "./base.ts";
import type { AssignmentTarget } from "./expressions.ts";
import type { BindingPattern, MatchPattern } from "./patterns.ts";
import type { TypeParameterDeclaration, TypeReference, TypeSyntax } from "./types.ts";

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
  /**
   * CO-I7: the written export name alone. `span` covers `imported as local`,
   * which is the right underline for a collision between two specifiers and
   * the wrong one for a report about the export name — and a specifier the
   * compiler synthesizes has no written name at all, so this is optional.
   */
  readonly importedSpan?: Span;
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
  /** CO-I7: the written export name alone; `span` covers `imported as exported`. */
  readonly importedSpan?: Span;
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
  /** Acorn-owned editor classifications; never Velar symbols or references. */
  readonly editorTokens: readonly EmbeddedJavaScriptEditorToken[];
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
  /** CO-I13: where the name is written, which is what a refusal of it underlines. */
  readonly nameSpan: Span;
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
  /** Every field, including inherited fields, is exposed as deeply read-only. */
  readonly readonly: boolean;
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
  /**
   * D102 ruling 1: the runtime wire value — a string, or a safe integer when
   * the protocol pins a numeric version (`v2 = 2`). Defaults to the member's
   * own name when no explicit value is written. The two kinds are distinct
   * values: `"2"` and `2` may stand in one enum and neither parses as the
   * other.
   */
  readonly value: string | number;
  readonly valueSpan?: Span;
  readonly span: Span;
}

export interface ClassDeclaration {
  readonly kind: "ClassDeclaration";
  readonly exported: boolean;
  readonly abstract: boolean;
  readonly name: string;
  /** D55 rule 120 layer two: `class Stack<T>` / `class Stack<T: Comparable>`, the same list `def` and `type` take. */
  readonly typeParameters?: readonly TypeParameterDeclaration[];
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
 * author publishes, so it cannot be called from source either. It has two
 * forms, told apart by the answer's shape (D90 R18): the synchronous form
 * answers with a List, Set, Map, or Record the language already knows how to
 * iterate, and the asynchronous pull form answers `T?` — `async for` drives
 * it once per element, it may await, and null is exhaustion. No iterator
 * protocol enters the language (charter section 19 stands).
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
  /** The name alone, so a refusal about the base class can point at it rather than at its arguments. */
  readonly nameSpan: Span;
  /**
   * D55 rule 120 layer two: `extends Stack<number>`. A base that names a
   * generic class must apply it — a bare `Stack` is the same missing-arity
   * refusal every other type position gives.
   */
  readonly typeArguments?: readonly TypeSyntax[];
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

/**
 * 模块的程序入口区域。
 *
 * `@main` 属于编译器拥有的模块角色，不是可以导出或调用的普通函数。编译器仍会
 * 检查每个模块中的入口代码，但只有项目选中的入口模块会生成并执行这个区域；
 * 因此一个既能被导入、又能被直接运行的模块不会因为普通导入而启动程序。
 *
 * `keywordSpan` 只覆盖 `@main`，供语义高亮、悬浮说明和精确诊断使用；`span`
 * 覆盖整个区域，`body` 同时承载单行和缩进两种正文形式。
 */
export interface MainBlock {
  readonly kind: "MainBlock";
  readonly keywordSpan: Span;
  readonly body: readonly Statement[];
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

export interface ExpressionStatement {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
  readonly span: Span;
}

/**
 * `detach <expression>` runs a `Promise<null>` expression detached: the
 * statement does not wait, and the emitter hands the Promise to a
 * compiler-owned observer that reports rejection through the host error
 * channel instead of letting it float.
 */
export interface DetachStatement {
  readonly kind: "DetachStatement";
  readonly expression: Expression;
  readonly span: Span;
}
